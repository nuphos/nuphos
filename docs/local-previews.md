# Local preview cards

Proposed on `feat/local-preview-card`; no deployment is implied.

Standalone local links and tool-discovered local URLs get a larger card with
title, visible address and a clear Open action. Links within prose retain their
compact treatment so words and punctuation stay in their original order.

MessageResponse uses standaloneLocalLink to identify a paragraph containing
only one validated local link and optional terminal punctuation. It asks the
existing renderer for standalone presentation; a declined renderer falls back
to the original children. useAgentLinks forwards that option to useLocalUrlLinks.
LocalUrlChip selects the card variant, and LocalUrlStrip uses cards for its
existing discovered URLs. Ambiguous paragraphs stay inline.

The shared ChatLink preserves browser-pane routing, modifier-click and context
menus. Local URL validation, credential rejection and own-machine URL discovery
remain unchanged. Rendering the card makes no request to a local service.
The page opens in the existing browser pane when the user clicks Open.

Evidence uses neutral synthetic Markdown and the actual light-theme renderers.
Browser checks exercise the real callback without requesting any local service;
these are component captures, not installed-app or live-server captures.

![Before and after](images/local-previews/local-preview-before-after.png)
![390px](images/local-previews/local-preview-mobile.png)
