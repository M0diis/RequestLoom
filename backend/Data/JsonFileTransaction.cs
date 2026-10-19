using System.Text.Json;

namespace RequestLoom.Api.Data;

/// <summary>Stages a document's files together and rolls back an interrupted commit on startup.</summary>
internal static class JsonFileTransaction
{
    private sealed record Entry(string Target, string Staged, bool Existed);

    public static void Commit(string rootPath, IReadOnlyDictionary<string, string> files)
    {
        Recover(rootPath);
        var entries = new List<Entry>();
        var journal = rootPath + ".transaction.json";
        var transactionId = Guid.NewGuid().ToString("N");
        var journalWritten = false;
        try
        {
            foreach (var (path, content) in files)
            {
                var target = Path.GetFullPath(path);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                var entry = new Entry(target, target + ".pending-" + transactionId, File.Exists(target));
                entries.Add(entry);
                File.WriteAllText(entry.Staged, content);
                if (entry.Existed) File.Copy(target, target + ".bak", overwrite: true);
            }

            File.WriteAllText(journal + ".tmp", JsonSerializer.Serialize(entries));
            File.Move(journal + ".tmp", journal, overwrite: true);
            journalWritten = true;
            foreach (var entry in entries) File.Move(entry.Staged, entry.Target, overwrite: true);
            File.Delete(journal);
            journalWritten = false;
        }
        catch
        {
            if (journalWritten) Recover(rootPath);
            throw;
        }
        finally
        {
            // If rollback failed, leave the journal and staged files for recovery.
            if (!File.Exists(journal))
                foreach (var entry in entries) File.Delete(entry.Staged);
        }
    }

    public static void Recover(string rootPath)
    {
        var journal = rootPath + ".transaction.json";
        if (!File.Exists(journal)) return;
        var entries = JsonSerializer.Deserialize<List<Entry>>(File.ReadAllText(journal))
            ?? throw new InvalidDataException($"Invalid storage transaction: {journal}. Original files were preserved.");
        foreach (var entry in entries)
        {
            if (!Path.IsPathFullyQualified(entry.Target) ||
                !entry.Staged.StartsWith(entry.Target + ".pending-", StringComparison.Ordinal))
                throw new InvalidDataException($"Invalid storage transaction: {journal}.");
            if (entry.Existed) File.Copy(entry.Target + ".bak", entry.Target, overwrite: true);
            else File.Delete(entry.Target);
        }
        File.Delete(journal);
        foreach (var entry in entries) File.Delete(entry.Staged);
    }
}
