#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
swiftc BotAvatars/BotAvatars.swift tests/BotAvatarTests.swift nuphos-ios/Services/Chat/ThreadReference.swift nuphos-ios/Services/ImageAttachment.swift tests/ImageAttachmentTests.swift nuphos-ios/Services/PastedFile.swift tests/PastedFileTests.swift nuphos-ios/Services/Chat/JSONValue.swift nuphos-ios/Services/Chat/RuntimeObservation.swift nuphos-ios/Services/Chat/ConversationUnread.swift nuphos-ios/Services/Chat/ChatModels.swift nuphos-ios/Services/NuphosAPIBase.swift nuphos-ios/Services/Chat/RuntimeTranscript.swift nuphos-ios/Services/Chat/UIStreamReducer.swift nuphos-ios/Services/Chat/ToolRuns.swift nuphos-ios/Services/Chat/ReasoningText.swift Shared/SessionLink.swift nuphos-ios/Services/Chat/AppLink.swift nuphos-ios/Views/Chat/PlanLink.swift tests/AppLinkTests.swift nuphos-ios/Services/Chat/StreamBacklog.swift nuphos-ios/Services/Chat/SSEClient.swift nuphos-ios/Services/Chat/StreamingMarkdown.swift nuphos-ios/Services/Chat/MessagePreview.swift nuphos-ios/Views/Chat/ChatRow.swift nuphos-ios/Models/Channel.swift nuphos-ios/Views/Home/ChatTime.swift tests/ChannelPostTests.swift nuphos-ios/Services/Chat/TransferDownloads.swift nuphos-ios/Services/Chat/TransferFiles.swift tests/TransferFilesTests.swift nuphos-ios/Views/Home/ComposerAction.swift nuphos-ios/Views/Home/SessionMention.swift nuphos-ios/Models/AgentConversation.swift nuphos-ios/Services/ConversationNesting.swift nuphos-ios/Services/Chat/BotQuestions.swift tests/BotQuestionsTests.swift nuphos-ios/Models/CredentialCatalog.swift nuphos-ios/Models/AgentRuntime.swift nuphos-ios/Models/ShareApproval.swift tests/ShareApprovalTests.swift nuphos-ios/Models/NuphosUser.swift nuphos-ios/Models/Team.swift nuphos-ios/Services/LaunchCache.swift tests/LaunchCacheTests.swift nuphos-ios/Services/Chat/ComposerDrafts.swift tests/ChatRowTests.swift tests/ComposerDraftsTests.swift tests/CredentialScopeTests.swift tests/ComposerActionTests.swift tests/SessionLinkTests.swift tests/SessionMentionTests.swift tests/SidebarFavoritesTests.swift tests/ConversationNestingTests.swift tests/ResourceStripTests.swift tests/StreamBacklogTests.swift tests/SSEClientTests.swift tests/StreamingMarkdownTests.swift tests/MessagePreviewTests.swift nuphos-ios/Services/Chat/MarkdownImages.swift tests/MarkdownImagesTests.swift tests/LocalAgentTests.swift nuphos-ios/Services/SignInSessions.swift tests/SignInSessionsTests.swift Shared/TurnActivityAttributes.swift tests/LiveActivityCardTests.swift tests/RuntimeObservationTests.swift nuphos-ios/Services/Chat/ResumeFallback.swift tests/ResumeFallbackTests.swift nuphos-ios/Services/Chat/DockDestination.swift tests/DockDestinationTests.swift -o "$test_dir/runtime-tests"
desktop=nuphos-ios/Services/Desktop
swiftc "$desktop/ZlibStream.swift" "$desktop/RFBFramebuffer.swift" "$desktop/RFBClient.swift" "$desktop/RFBKeysym.swift" "$desktop/H264Stream.swift" tests/DesktopTests.swift -o "$test_dir/desktop-tests"
"$test_dir/desktop-tests"
"$test_dir/runtime-tests"
bash tests/analytics.sh
bash tests/social-login.sh
bash tests/auth-session.sh

swiftc nuphos-ios/Services/Chat/JSONValue.swift ShareSupport/SharedShareSession.swift tests/ShareSessionLeaseTests.swift -o "$test_dir/share-lease-tests"
"$test_dir/share-lease-tests"
swiftc -D DEBUG -parse-as-library nuphos-ios/Services/NuphosAPIBase.swift nuphos-ios/Services/PreviewIsolation.swift nuphos-ios/Services/PreviewTransport.swift nuphos-ios/Services/Chat/SSEClient.swift tests/PreviewIsolationTests.swift -o "$test_dir/preview-isolation-tests"
"$test_dir/preview-isolation-tests"
swiftc NuphosShare/ShareFollowState.swift tests/ShareFollowStateTests.swift -o "$test_dir/share-follow-tests"
"$test_dir/share-follow-tests"
swiftc nuphos-ios/Views/Home/HomeColumns.swift tests/HomeColumnsTests.swift -o "$test_dir/home-columns-tests"
"$test_dir/home-columns-tests"
