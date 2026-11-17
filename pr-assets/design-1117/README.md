# Nuphos Android monochrome marks

Derived with Potrace from the alpha channel of the official nuphos.ai/brand/nuphos-icon-mono-white.svg raster, threshold 128, curve optimization tolerance 0.15 source pixels. These are traced vectors, not original brand master paths.

- nuphos-notification.svg: 24 x 24, white on transparent, visible mark 20dp wide, centered (2dp horizontal padding).
- nuphos-monochrome.svg: 108 x 108, white on transparent, entire visible mark fits inside the centered 66dp diameter safe circle.

Both contain a real cubic path, no bitmap, mask, filter, stroke or background. Preserve the path transform when converting to VectorDrawable, or bake it into the coordinates. Notification color comes from alpha; launcher tint comes from Android.
