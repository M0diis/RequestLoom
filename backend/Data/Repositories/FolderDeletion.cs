namespace RequestLoom.Api.Data.Repositories;

internal static class FolderDeletion
{
    /// <summary>
    /// Returns the folder with the given id and all of its descendants, deepest first.
    /// </summary>
    public static List<T> CollectSubtree<T>(IReadOnlyCollection<T> folders, string folderId)
        where T : class
    {
        var byParent = folders
            .GroupBy(folder => ParentId(folder) ?? "")
            .ToDictionary(group => group.Key, group => group.ToList());
        var root = folders.FirstOrDefault(folder => Id(folder) == folderId);
        if (root == null) return [];

        var ordered = new List<T>();
        var seen = new HashSet<string>();
        void Visit(T folder)
        {
            if (!seen.Add(Id(folder))) return;
            ordered.Add(folder);
            if (byParent.TryGetValue(Id(folder), out var children))
                foreach (var child in children) Visit(child);
        }

        Visit(root);
        ordered.Reverse();
        return ordered;
    }

    private static string Id<T>(T folder) => folder switch
    {
        Entities.RequestFolderRow row => row.Id,
        Models.RequestFolder model => model.Id,
        _ => throw new ArgumentException("Unsupported folder type"),
    };

    private static string? ParentId<T>(T folder) => folder switch
    {
        Entities.RequestFolderRow row => row.ParentFolderId,
        Models.RequestFolder model => model.ParentFolderId,
        _ => throw new ArgumentException("Unsupported folder type"),
    };
}
