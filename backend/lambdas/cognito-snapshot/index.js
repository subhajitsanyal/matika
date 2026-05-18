/**
 * F47 — Cognito Snapshot Lambda
 *
 * Nightly export of the Cognito user pool config + roster to S3. Closes
 * the F47 RPO gap documented in docs/dr_runbook_v2.md §3: until this
 * lambda lands, the recovery point for a Cognito user-pool config or
 * roster corruption event was unbounded (= since last manual snapshot).
 *
 * Captures three artifacts per run:
 *   1. user-pool config (DescribeUserPool)
 *   2. groups (ListGroups, paginated)
 *   3. roster (ListUsers, paginated) — INCLUDES per-group membership via
 *      ListUsersInGroup so a restore can rebuild group attachments
 *
 * Output path: s3://{DOCUMENTS_BUCKET}/cognito-snapshots/{YYYY-MM-DD}/
 *   - pool.json
 *   - groups.json
 *   - users.json   (single combined file; user objects carry their groups[])
 *   - manifest.json (file list + per-file SHA256, written last as the
 *     completion sentinel — the snapshot-missing alarm hunts for it)
 *
 * Triggered nightly by EventBridge (cron 0 2 * * ? * = 02:00 UTC daily).
 * S3 lifecycle (declared in modules/s3/main.tf) transitions
 * cognito-snapshots/ to GLACIER after 30 days.
 */

const {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  ListGroupsCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

async function describePool() {
  const resp = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: USER_POOL_ID }));
  return resp.UserPool;
}

async function listGroupsAll() {
  const groups = [];
  let nextToken;
  do {
    const resp = await cognito.send(new ListGroupsCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60,
      NextToken: nextToken,
    }));
    groups.push(...(resp.Groups || []));
    nextToken = resp.NextToken;
  } while (nextToken);
  return groups;
}

async function listUsersInGroup(groupName) {
  const usernames = new Set();
  let nextToken;
  do {
    const resp = await cognito.send(new ListUsersInGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: groupName,
      Limit: 60,
      NextToken: nextToken,
    }));
    for (const u of resp.Users || []) usernames.add(u.Username);
    nextToken = resp.NextToken;
  } while (nextToken);
  return usernames;
}

async function listUsersAll() {
  const users = [];
  let paginationToken;
  do {
    const resp = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60,
      PaginationToken: paginationToken,
    }));
    users.push(...(resp.Users || []));
    paginationToken = resp.PaginationToken;
  } while (paginationToken);
  return users;
}

function hashOf(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function putObject(key, body, metadata = {}) {
  await s3.send(new PutObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    ServerSideEncryption: 'aws:kms',
    Metadata: metadata,
  }));
}

exports.handler = async (event) => {
  if (!USER_POOL_ID || !DOCUMENTS_BUCKET) {
    throw new Error(
      `Missing required env vars: COGNITO_USER_POOL_ID=${USER_POOL_ID}, DOCUMENTS_BUCKET=${DOCUMENTS_BUCKET}`
    );
  }

  const startedAt = new Date();
  const dateKey = startedAt.toISOString().slice(0, 10);
  const prefix = `cognito-snapshots/${dateKey}/`;

  console.log(`F47 cognito-snapshot start — pool=${USER_POOL_ID} prefix=s3://${DOCUMENTS_BUCKET}/${prefix}`);

  const [pool, groups, usersRaw] = await Promise.all([
    describePool(),
    listGroupsAll(),
    listUsersAll(),
  ]);

  const groupMemberships = {};
  for (const g of groups) {
    groupMemberships[g.GroupName] = await listUsersInGroup(g.GroupName);
  }

  const users = usersRaw.map((u) => {
    const memberOf = [];
    for (const [gname, members] of Object.entries(groupMemberships)) {
      if (members.has(u.Username)) memberOf.push(gname);
    }
    return { ...u, Groups: memberOf };
  });

  const poolBody = JSON.stringify(pool, null, 2);
  const groupsBody = JSON.stringify(groups, null, 2);
  const usersBody = JSON.stringify(users, null, 2);

  await putObject(`${prefix}pool.json`, poolBody);
  await putObject(`${prefix}groups.json`, groupsBody);
  await putObject(`${prefix}users.json`, usersBody);

  const finishedAt = new Date();
  const manifest = {
    snapshotDate: dateKey,
    poolId: USER_POOL_ID,
    region: REGION,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    files: [
      { key: `${prefix}pool.json`, sha256: hashOf(poolBody), bytes: Buffer.byteLength(poolBody) },
      { key: `${prefix}groups.json`, sha256: hashOf(groupsBody), bytes: Buffer.byteLength(groupsBody) },
      { key: `${prefix}users.json`, sha256: hashOf(usersBody), bytes: Buffer.byteLength(usersBody) },
    ],
    counts: {
      groups: groups.length,
      users: users.length,
    },
  };
  await putObject(`${prefix}manifest.json`, JSON.stringify(manifest, null, 2));

  console.log(
    `F47 cognito-snapshot done — wrote 4 files (pool + groups + users + manifest) under ${prefix}; users=${users.length}, groups=${groups.length}, durationMs=${manifest.durationMs}`
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      snapshotDate: dateKey,
      prefix,
      counts: manifest.counts,
    }),
  };
};
