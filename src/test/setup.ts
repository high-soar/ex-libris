import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

if (
  typeof Blob !== "undefined" &&
  typeof Blob.prototype.arrayBuffer !== "function"
) {
  Blob.prototype.arrayBuffer = function arrayBuffer(
    this: Blob,
  ): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as ArrayBuffer);
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error("Failed to read Blob as ArrayBuffer"));
      };
      reader.readAsArrayBuffer(this);
    });
  };
}
