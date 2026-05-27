/**
 * Unit tests for headKosObject — verifies the §3 PR-1 return-shape
 * extension. We mock the AWS S3 SDK at the module boundary so the
 * test does not need real AWS credentials.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  // Minimal shim: every Command class is just a value carrier; the
  // S3Client.send is the boundary we want to control.
  class HeadObjectCommand {
    public readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class PutObjectCommand {
    public readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    public readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class S3Client {
    constructor(_cfg: unknown) {
      void _cfg;
    }
    send = sendMock;
  }
  return { HeadObjectCommand, PutObjectCommand, GetObjectCommand, S3Client };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://example.test/signed"),
}));

// Tenant payload — readS3Config inside s3-client reads these env vars
// to instantiate the client. Stub them on the env BEFORE importing.
beforeEach(() => {
  process.env.AWS_TEST_ACCESS_KEY = "AKIATEST";
  process.env.AWS_TEST_SECRET = "secret";
  sendMock.mockReset();
});

// We import the SUT after the mocks are in place.
import { headKosObject } from "../s3-client";
import type { Tenant } from "@prisma/client";

function buildTenant(): Tenant {
  return {
    id: "tenant_1",
    slug: "kalzen",
    name: "Kalzen",
    customDomain: null,
    branding: {},
    whatsappConfig: null,
    frappeConfig: null,
    s3Config: {
      bucket: "kalzen-test",
      region: "ap-south-1",
      accessKeyRef: "AWS_TEST_ACCESS_KEY",
      secretKeyRef: "AWS_TEST_SECRET",
    },
    featureFlags: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Tenant;
}

describe("headKosObject (PR 1 extension)", () => {
  it("returns { exists: true, contentLength, contentType, ... } on a successful HEAD", async () => {
    const tenant = buildTenant();
    const lastModified = new Date("2026-05-27T00:00:00Z");
    sendMock.mockResolvedValueOnce({
      ContentLength: 12345,
      ContentType: "application/dxf",
      LastModified: lastModified,
      ETag: '"abcdef123"',
    });

    const result = await headKosObject(tenant, "drawings/tenant_1/cust/draw/source.dxf");

    expect(result.exists).toBe(true);
    expect(result.contentLength).toBe(12345);
    expect(result.contentType).toBe("application/dxf");
    expect(result.lastModified).toEqual(lastModified);
    expect(result.etag).toBe("abcdef123");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("returns { exists: true, contentLength: undefined } when AWS responds without ContentLength", async () => {
    const tenant = buildTenant();
    sendMock.mockResolvedValueOnce({});

    const result = await headKosObject(tenant, "drawings/x/y/z.dxf");

    expect(result.exists).toBe(true);
    expect(result.contentLength).toBeUndefined();
  });

  it("returns { exists: false } on AWS 404 (NotFound)", async () => {
    const tenant = buildTenant();
    const err: Error & { $metadata?: { httpStatusCode?: number } } = new Error("NotFound");
    err.name = "NotFound";
    err.$metadata = { httpStatusCode: 404 };
    sendMock.mockRejectedValueOnce(err);

    const result = await headKosObject(tenant, "missing.dxf");

    expect(result.exists).toBe(false);
    expect(result.contentLength).toBeUndefined();
  });

  it("returns { exists: false } on AWS 403 (treated as not-visible)", async () => {
    const tenant = buildTenant();
    const err: Error & { $metadata?: { httpStatusCode?: number } } = new Error("Forbidden");
    err.$metadata = { httpStatusCode: 403 };
    sendMock.mockRejectedValueOnce(err);

    const result = await headKosObject(tenant, "forbidden.dxf");

    expect(result.exists).toBe(false);
  });

  it("throws KosError on generic AWS errors (e.g. 500 / network)", async () => {
    const tenant = buildTenant();
    const err: Error & { $metadata?: { httpStatusCode?: number } } = new Error("InternalError");
    err.$metadata = { httpStatusCode: 500 };
    sendMock.mockRejectedValueOnce(err);

    await expect(headKosObject(tenant, "key.dxf")).rejects.toMatchObject({
      code: "KOS_S3_011",
      httpStatus: 500,
    });
  });

  it("strips surrounding quotes from ETag", async () => {
    const tenant = buildTenant();
    sendMock.mockResolvedValueOnce({
      ContentLength: 10,
      ETag: '"d41d8cd98f00b204e9800998ecf8427e"',
    });
    const result = await headKosObject(tenant, "k");
    expect(result.etag).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
});
