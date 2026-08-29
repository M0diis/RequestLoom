using RequestLoom.Api.Models;

namespace RequestLoom.Api.Services;

public sealed class RequestUploadService
{
    private const string UploadDirectoryName = "request-uploads";
    private readonly string _rootDirectory;

    public RequestUploadService(SettingsService settings)
    {
        var storageDirectory = Path.GetDirectoryName(settings.StoragePath) ?? AppContext.BaseDirectory;
        _rootDirectory = Path.Combine(storageDirectory, UploadDirectoryName);
    }

    public string RootDirectory => _rootDirectory;

    public async Task<RequestFileUploadResponse> SaveAsync(
        string requestId,
        Stream content,
        string fileName,
        string? contentType,
        long size,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(requestId)) throw new InvalidOperationException("Request ID is required.");

        Directory.CreateDirectory(_rootDirectory);
        var safeName = SanitizeFileName(fileName);
        var storedName = $"{Guid.NewGuid():N}_{safeName}";
        var targetPath = ResolveWithinRoot(storedName);

        await using (var target = new FileStream(targetPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            await content.CopyToAsync(target, cancellationToken);
        }

        return new RequestFileUploadResponse
        {
            FilePath = $"{UploadDirectoryName}/{storedName}",
            FileName = safeName,
            ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim(),
            Size = size,
        };
    }

    public string ResolvePath(string storedPath)
    {
        if (string.IsNullOrWhiteSpace(storedPath))
            throw new InvalidOperationException("Multipart file path is required.");

        var normalized = storedPath.Trim().Replace('\\', '/');
        var prefix = UploadDirectoryName + "/";
        if (!normalized.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("../", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Multipart file path is outside the RequestLoom upload directory.");
        }

        return ResolveWithinRoot(normalized[prefix.Length..]);
    }

    private string ResolveWithinRoot(string relativePath)
    {
        var fullPath = Path.GetFullPath(Path.Combine(_rootDirectory, relativePath));
        var root = Path.GetFullPath(_rootDirectory) + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("File path is outside the RequestLoom upload directory.");
        return fullPath;
    }

    private static string SanitizeFileName(string fileName)
    {
        var name = Path.GetFileName(fileName ?? "").Trim();
        if (string.IsNullOrWhiteSpace(name)) name = "upload.bin";

        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(name.Select(character => invalid.Contains(character) ? '_' : character).ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "upload.bin" : sanitized;
    }
}
