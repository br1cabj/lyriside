const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const context = { chrome: { runtime: { onMessage: { addListener() {} }, sendMessage() { return { catch() {} }; } } }, setInterval() {} };
vm.runInNewContext(`${fs.readFileSync("src/content/youtube-metadata.js", "utf8")};globalThis.extract=timestampEntries;globalThis.infer=inferMusicMetadata;`, context);

test("acepta capítulos de conciertos con numeración", () => {
  const tracks = context.extract("01) 00:02:29 Song A\n02) 01:03:12 Song B", "Descripción");
  assert.equal(tracks.length, 2);
  assert.equal(tracks[1].seconds, 3792);
});

test("infiere artista y canción desde un video musical", () => {
  const result = context.infer("Artista - Canción (Official Video)");
  assert.equal(result.artist, "Artista");
  assert.equal(result.track, "Canción");
});
