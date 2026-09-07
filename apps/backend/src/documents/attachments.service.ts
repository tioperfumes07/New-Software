import crypto from "node:crypto";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { generatePresignedDownloadUrl, generatePresignedUploadUrl, getR2BucketName, verifyObjectExists } from "../storage/r2-client.js";

const SOURCE_TAG = "P6-FOUNDATION-UNIVERSAL-UPLOAD";
const MAX_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "video/mp4",
]);

type DbClient = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number }>;
};

function sanitizeFilename(filename: string) {
  return filename
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
}

function ensureAllowedContentType(contentType: string) {
  const normalized = contentType.toLowerCase().trim();
  if (!ALLOWED_CONTENT_TYPES.has(normalized)) throw new Error("unsupported_content_type");
}

function ensureAllowedSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("invalid_file_size");
  if (sizeBytes > MAX_SIZE_BYTES) throw new Error("file_too_large");
}

async function setCompanyScope(client: DbClient, operatingCompanyId: string) {
  await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
}

/** Entity types whose create forms attach files BEFORE the record exists (random draft entity_id). */
// SETL-DED-UI — the settlement-deduction creator has no dedicated attachments entity_type (adding
// one needs a migration to attachments_entity_type_check, out of this item's lane); its "source doc"
// control reuses the existing, already-permitted 'manual' entity_type (documents.attachments'
// generic bucket, unused elsewhere in the codebase today) instead of widening the CHECK constraint.
const RECONCILABLE_ENTITY_TYPES = new Set(["bill", "expense", "invoice", "payment", "work_order", "manual"]);

/**
 * Option B (attachment-draft-reconcile): re-key create-time draft attachments onto the real record id,
 * INSIDE the caller's transaction so it is atomic with the record insert (no orphan window). UploadZone
 * uploads files under a random draft `entity_id` before the record exists; this moves those rows to
 * `newId` so the detail page (which reads attachments by the real record id) shows them. Without this,
 * every receipt/bill-scan/WO-photo added during creation is silently orphaned (see
 * docs/specs/ATTACHMENT-DRAFT-LINKAGE-FIX.md).
 *
 * Per-entity scope is enforced via `operating_company_id` (TRANSP/TRK/USMCA never cross). No-op when no
 * draft id is supplied or it already equals the record id. Rows whose target `(oci, sha256, entity_type,
 * newId)` already exists are skipped to honor the UNIQUE constraint (idempotent re-runs, dup uploads).
 * Returns the number of attachments re-linked.
 */
export async function reassignDraftAttachments(
  client: DbClient,
  params: { operatingCompanyId: string; entityType: string; draftId: string | null | undefined; newId: string }
): Promise<number> {
  const { operatingCompanyId, entityType, draftId, newId } = params;
  if (!draftId || draftId === newId) return 0;
  if (!RECONCILABLE_ENTITY_TYPES.has(entityType)) throw new Error("unsupported_reconcile_entity_type");
  await setCompanyScope(client, operatingCompanyId);
  const res = await client.query(
    `UPDATE documents.attachments a
        SET entity_id = $4::uuid
      WHERE a.operating_company_id = $1::uuid
        AND a.entity_type = $2
        AND a.entity_id = $3::uuid
        AND NOT EXISTS (
          SELECT 1 FROM documents.attachments b
           WHERE b.operating_company_id = $1::uuid
             AND b.entity_type = $2
             AND b.entity_id = $4::uuid
             AND b.sha256_hash = a.sha256_hash
        )`,
    [operatingCompanyId, entityType, draftId, newId]
  );
  return res.rowCount ?? 0;
}

export async function generateAttachmentUploadUrl(
  userId: string,
  input: {
    operatingCompanyId: string;
    entityType: string;
    entityId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }
) {
  ensureAllowedContentType(input.contentType);
  ensureAllowedSize(input.sizeBytes);
  const attachmentId = crypto.randomUUID();
  const safeName = sanitizeFilename(input.filename) || "file";
  const objectKey = `${input.operatingCompanyId}/${input.entityType}/${input.entityId}/${attachmentId}-${safeName}`;
  return withCurrentUser(userId, async (client) => {
    await setCompanyScope(client, input.operatingCompanyId);
    await client.query(
      `
        INSERT INTO documents.attachments (
          id,
          operating_company_id,
          entity_type,
          entity_id,
          category,
          filename,
          content_type,
          size_bytes,
          sha256_hash,
          r2_object_key,
          r2_bucket,
          uploaded_by_user_id,
          notes
        )
        VALUES ($1,$2,$3,$4,'other',$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        attachmentId,
        input.operatingCompanyId,
        input.entityType,
        input.entityId,
        input.filename,
        input.contentType.toLowerCase().trim(),
        input.sizeBytes,
        `pending:${attachmentId}`,
        objectKey,
        getR2BucketName(),
        userId,
        "pending_finalize",
      ]
    );
    const signed = await generatePresignedUploadUrl(objectKey, input.contentType, 900);
    return {
      attachment_id: attachmentId,
      upload_url: signed.url,
      expires_in_seconds: 900,
      r2_object_key: objectKey,
    };
  });
}

export async function finalizeAttachmentUpload(
  userId: string,
  input: {
    attachmentId: string;
    operatingCompanyId: string;
    sha256Hash: string;
    category: string;
  }
) {
  return withCurrentUser(userId, async (client) => {
    await setCompanyScope(client, input.operatingCompanyId);
    const currentRes = await client.query<{
      id: string;
      r2_object_key: string;
      entity_type: string;
      entity_id: string;
      is_deleted: boolean;
    }>(
      `
        SELECT id, r2_object_key, entity_type, entity_id, is_deleted
        FROM documents.attachments
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
      `,
      [input.attachmentId, input.operatingCompanyId]
    );
    const current = currentRes.rows[0];
    if (!current || current.is_deleted) throw new Error("attachment_not_found");
    const exists = await verifyObjectExists(current.r2_object_key);
    if (!exists) throw new Error("uploaded_object_not_found");

    const duplicateRes = await client.query<{ id: string }>(
      `
        SELECT id
        FROM documents.attachments
        WHERE operating_company_id = $1::uuid
          AND entity_type = $2
          AND entity_id = $3
          AND sha256_hash = $4
          AND is_deleted = false
          AND id <> $5
        LIMIT 1
      `,
      [input.operatingCompanyId, current.entity_type, current.entity_id, input.sha256Hash, input.attachmentId]
    );
    const duplicate = duplicateRes.rows[0];
    if (duplicate?.id) {
      await client.query(
        `
          UPDATE documents.attachments
          SET is_deleted = true,
              deleted_at = now(),
              deleted_by_user_id = $2,
            notes = 'deduped_by_sha256'
          WHERE id = $1
        `,
        [input.attachmentId, userId]
      );
      return { id: duplicate.id, deduped: true };
    }

    await client.query(
      `
        UPDATE documents.attachments
        SET sha256_hash = $2,
            category = $3,
            notes = NULL
        WHERE id = $1
      `,
      [input.attachmentId, input.sha256Hash.toLowerCase(), input.category]
    );

    await appendCrudAudit(
      client,
      userId,
      "documents.attachment.uploaded",
      {
        resource_type: "documents.attachments",
        resource_id: input.attachmentId,
        operating_company_id: input.operatingCompanyId,
        category: input.category,
      },
      "info",
      SOURCE_TAG
    );

    return { id: input.attachmentId, deduped: false };
  });
}

export async function listAttachments(userId: string, input: { operatingCompanyId: string; entityType: string; entityId: string }) {
  return withCurrentUser(userId, async (client) => {
    await setCompanyScope(client, input.operatingCompanyId);
    const res = await client.query(
      `
        SELECT *
        FROM documents.attachments
        WHERE operating_company_id = $1::uuid
          AND entity_type = $2
          AND entity_id = $3::uuid
          AND is_deleted = false
        ORDER BY uploaded_at DESC, created_at DESC
      `,
      [input.operatingCompanyId, input.entityType, input.entityId]
    );
    return res.rows;
  });
}

export async function generateAttachmentDownloadUrl(userId: string, input: { attachmentId: string; operatingCompanyId: string }) {
  return withCurrentUser(userId, async (client) => {
    await setCompanyScope(client, input.operatingCompanyId);
    const res = await client.query<{ r2_object_key: string; id: string }>(
      `
        SELECT id, r2_object_key
        FROM documents.attachments
        WHERE id = $1
          AND operating_company_id = $2::uuid
          AND is_deleted = false
        LIMIT 1
      `,
      [input.attachmentId, input.operatingCompanyId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("attachment_not_found");
    const signed = await generatePresignedDownloadUrl(row.r2_object_key, 900);
    return { id: row.id, download_url: signed.url, expires_in_seconds: 900 };
  });
}

export async function softDeleteAttachment(userId: string, input: { attachmentId: string; operatingCompanyId: string }) {
  return withCurrentUser(userId, async (client) => {
    await setCompanyScope(client, input.operatingCompanyId);
    const res = await client.query<{ id: string }>(
      `
        UPDATE documents.attachments
        SET is_deleted = true,
            deleted_at = now(),
            deleted_by_user_id = $2
        WHERE id = $1
          AND operating_company_id = $3::uuid
          AND is_deleted = false
        RETURNING id
      `,
      [input.attachmentId, userId, input.operatingCompanyId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("attachment_not_found");
    await appendCrudAudit(
      client,
      userId,
      "documents.attachment.deleted",
      {
        resource_type: "documents.attachments",
        resource_id: row.id,
        operating_company_id: input.operatingCompanyId,
      },
      "warning",
      SOURCE_TAG
    );
    return { id: row.id };
  });
}
