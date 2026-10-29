package ai.nuphos.android;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Test APK only; uses framework/Java APIs because its provider runs without the target classpath. */
public class ContentInputFixtureProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return uri.getLastPathSegment().endsWith(".png") ? "image/png" : uri.getLastPathSegment().endsWith(".mp4") ? "video/mp4" : "text/plain"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        cursor.addRow(new Object[]{uri.getLastPathSegment(), "oversize.txt".equals(uri.getLastPathSegment()) ? 101L * 1024 * 1024 : null});
        return cursor;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if ("denied.txt".equals(name)) throw new SecurityException("Synthetic read denied");
        if (!Arrays.asList("image.png", "fixture.txt", "invalid.png", "empty.txt", "delay.txt", "clip.mp4").contains(name)) throw new FileNotFoundException("Unknown synthetic fixture");
        File file = new File(getContext().getCacheDir(), "content-input-" + name);
        if ("delay.txt".equals(name)) android.os.SystemClock.sleep(1200);
        try (FileOutputStream output = new FileOutputStream(file)) {
            if ("image.png".equals(name)) {
                Bitmap bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888);
                try { bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); }
                finally { bitmap.recycle(); }
            } else if (!"empty.txt".equals(name)) {
                output.write("Synthetic attachment bytes".getBytes(StandardCharsets.UTF_8));
            }
        } catch (IOException failure) { throw new FileNotFoundException("Synthetic fixture unavailable"); }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
