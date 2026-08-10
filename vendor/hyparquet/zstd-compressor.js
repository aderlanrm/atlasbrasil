// Leitor mínimo para a única compactação publicada pelo Atlas Brasil.
import { decompress } from "./fzstd.js";

export const compressors = Object.freeze({
  ZSTD: (compressed) => decompress(compressed)
});
