# Retrieve Task evidence files over MCP

Call `nuphos_files` through `POST /mcp` with a readable `session_id`. It returns the Task's ready, unexpired file-transfer download groups with filenames, relative paths, sizes, content types, statuses, expiry timestamps and presigned `downloadUrl` values. Fetch each ready file's URL directly with an HTTP client to download the bytes. No file contents are copied into the MCP transcript.

The default response contains the newest 50 transfer groups. Set `limit` to 1–100 to adjust it. An empty `groups` list means no ready, unexpired published files were found. URLs are short lived; call the tool again to refresh them before the transfer itself expires. Storage configuration errors are returned as tool errors.

Agents must publish screenshots, video or logs through the existing file-transfer skill. This tool uses that same temporary store and its download signing service; it does not enumerate arbitrary runtime files, `render_artifact` HTML or cloud buckets. Listing follows the Task's existing conversation read permissions, includes files produced by teammates in that Task, and never includes another Task's groups.
