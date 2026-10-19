const { VectorStore } = require('./vector.store');

/**
 * EMBEDDER
 * Takes chunked text + an EmbeddingProvider, produces vectors, stores them.
 * Kept separate from chunker.js and vector.store.js so each piece has one job.
 */
async function embedAndStore(embeddingProvider, datasetId, chunks, { batchSize = 16 } = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) return { chunkCount: 0 };
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await embeddingProvider.embed(batch.map((c) => c.text));
    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      throw new Error(`Embedding provider returned ${vectors?.length ?? 0} vectors for a batch of ${batch.length} chunks.`);
    }
    const withVectors = batch.map((c, idx) => ({ ...c, embedding: vectors[idx] }));
    VectorStore.insertChunks(datasetId, withVectors);
  }
  return { chunkCount: chunks.length };
}

module.exports = { embedAndStore };
