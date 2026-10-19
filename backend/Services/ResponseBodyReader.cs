using System.Text;

namespace RequestLoom.Api.Services;

internal static class ResponseBodyReader
{
    public static async Task<(string Body, bool Truncated, long Size)> ReadAsync(
        HttpResponseMessage response, long maxBytes, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var output = new MemoryStream();
        var buffer = new byte[8192];
        var truncated = false;
        long observedBytes = 0;
        while (true)
        {
            // Read at most one byte beyond the limit to distinguish an exact-size body.
            var count = maxBytes > 0 ? (int)Math.Min(buffer.Length, maxBytes - output.Length + 1) : buffer.Length;
            var read = await stream.ReadAsync(buffer.AsMemory(0, count), cancellationToken);
            if (read == 0) break;
            observedBytes += read;
            var keep = maxBytes > 0 ? (int)Math.Min(read, maxBytes - output.Length) : read;
            output.Write(buffer, 0, keep);
            if (keep < read)
            {
                truncated = true;
                break;
            }
        }

        Encoding encoding;
        try { encoding = Encoding.GetEncoding(response.Content.Headers.ContentType?.CharSet?.Trim('"') ?? "utf-8"); }
        catch (ArgumentException) { encoding = Encoding.UTF8; }
        var bytes = output.GetBuffer().AsSpan(0, (int)output.Length);
        // Leave a partial final code point buffered when truncating instead of emitting a replacement glyph.
        var decoder = encoding.GetDecoder();
        var chars = new char[encoding.GetMaxCharCount(bytes.Length)];
        var length = decoder.GetChars(bytes, chars, flush: !truncated);
        return (new string(chars, 0, length), truncated,
            truncated ? response.Content.Headers.ContentLength ?? observedBytes : observedBytes);
    }
}
