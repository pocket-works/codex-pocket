import { afterEach, describe, expect, it, vi } from "vitest";
import { HostClient } from "../src/state/host-client.js";
import { clearUploadedImages, uploadedImageUrl } from "../src/ui/uploaded-image.js";

const computer = (id: string) => new HostClient({ id, instanceId: id, name: id, origin: `https://${id}.ts.net`, token: id, deviceId: id, lastRoute: "#/", notifications: false });
const path = "/uploads/0123456789abcdef.png";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("computer image cache", () => {
  it("isolates identical paths and releases only the disposed session's images", async () => {
    const request = vi.fn().mockImplementation(async () => new Response(new Blob(["image"])));
    vi.stubGlobal("fetch", request);
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:a").mockReturnValueOnce("blob:b");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const a = computer("a"); const b = computer("b");
    expect(await uploadedImageUrl(path, a)).toBe("blob:a");
    expect(await uploadedImageUrl(path, b)).toBe("blob:b");
    expect(await uploadedImageUrl(path, a)).toBe("blob:a");
    expect(create).toHaveBeenCalledTimes(2);
    a.dispose(); clearUploadedImages(a);
    await Promise.resolve();
    expect(revoke.mock.calls).toEqual([["blob:a"]]);
    expect(await uploadedImageUrl(path, a)).toBeNull();
    expect(await uploadedImageUrl(path, b)).toBe("blob:b");
    b.dispose(); clearUploadedImages(b);
  });

  it("retries failed image loads after connectivity returns", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response(new Blob(["image"])));
    vi.stubGlobal("fetch", request);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovered");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const host = computer("a");
    expect(await uploadedImageUrl(path, host)).toBeNull();
    expect(await uploadedImageUrl(path, host)).toBe("blob:recovered");
    expect(request).toHaveBeenCalledTimes(2);
    host.dispose(); clearUploadedImages(host);
  });
});
