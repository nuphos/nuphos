#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
swiftc nuphos-ios/Services/ImageAttachment.swift tests/ImageAttachmentTests.swift nuphos-ios/Services/Chat/JSONValue.swift nuphos-ios/Services/Chat/RuntimeObservation.swift nuphos-ios/Services/Chat/ConversationUnread.swift nuphos-ios/Services/Chat/ChatModels.swift nuphos-ios/Services/Chat/RuntimeTranscript.swift nuphos-ios/Services/Chat/UIStreamReducer.swift nuphos-ios/Services/Chat/ToolRuns.swift nuphos-ios/Services/Chat/ReasoningText.swift nuphos-ios/Services/Chat/SessionLink.swift nuphos-ios/Services/Chat/StreamBacklog.swift nuphos-ios/Services/Chat/SSEClient.swift nuphos-ios/Services/Chat/StreamingMarkdown.swift nuphos-ios/Views/Chat/ChatRow.swift nuphos-ios/Views/Home/ComposerAction.swift nuphos-ios/Models/AgentConversation.swift nuphos-ios/Models/CredentialCatalog.swift nuphos-ios/Models/AgentRuntime.swift nuphos-ios/Services/Chat/ComposerDrafts.swift tests/ChatRowTests.swift tests/ComposerDraftsTests.swift tests/CredentialScopeTests.swift tests/ComposerActionTests.swift tests/SessionLinkTests.swift tests/StreamBacklogTests.swift tests/SSEClientTests.swift tests/StreamingMarkdownTests.swift tests/LocalAgentTests.swift tests/RuntimeObservationTests.swift -o "$test_dir/runtime-tests"
"$test_dir/runtime-tests"
bash tests/analytics.sh
