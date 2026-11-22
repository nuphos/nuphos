#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
swiftc BotAvatars/BotAvatars.swift nuphos-ios/Services/BotFaces.swift tests/BotAvatarTests.swift nuphos-ios/Services/Chat/ThreadReference.swift nuphos-ios/Services/ImageAttachment.swift tests/ImageAttachmentTests.swift nuphos-ios/Services/PastedFile.swift tests/PastedFileTests.swift nuphos-ios/Services/Chat/JSONValue.swift nuphos-ios/Services/Chat/RuntimeObservation.swift nuphos-ios/Services/Chat/ConversationUnread.swift nuphos-ios/Services/Chat/ChatModels.swift nuphos-ios/Services/NuphosAPIBase.swift nuphos-ios/Services/Chat/RuntimeTranscript.swift nuphos-ios/Services/Chat/UIStreamReducer.swift nuphos-ios/Services/Chat/ToolRuns.swift nuphos-ios/Services/Chat/ReasoningText.swift Shared/SessionLink.swift nuphos-ios/Services/Chat/AppLink.swift nuphos-ios/Views/Chat/PlanLink.swift tests/AppLinkTests.swift nuphos-ios/Services/Chat/StreamBacklog.swift nuphos-ios/Services/Chat/SSEClient.swift nuphos-ios/Services/Chat/StreamingMarkdown.swift nuphos-ios/Services/Chat/MessagePreview.swift nuphos-ios/Views/Chat/ChatRow.swift nuphos-ios/Models/Channel.swift nuphos-ios/Views/Home/ChatTime.swift tests/ChannelPostTests.swift nuphos-ios/Services/Chat/TransferDownloads.swift nuphos-ios/Services/Chat/TransferFiles.swift tests/TransferFilesTests.swift nuphos-ios/Views/Home/ComposerAction.swift nuphos-ios/Views/Home/ComposerReturn.swift tests/ComposerReturnTests.swift nuphos-ios/Views/Home/SessionMention.swift nuphos-ios/Models/AgentConversation.swift nuphos-ios/Services/ConversationNesting.swift nuphos-ios/Services/Chat/BotQuestions.swift nuphos-ios/Services/Chat/AnsweredQuestion.swift tests/BotQuestionsTests.swift nuphos-ios/Models/CredentialCatalog.swift nuphos-ios/Models/AgentRuntime.swift nuphos-ios/Models/SelectorBox.swift nuphos-ios/Models/NewRuntime.swift tests/NewRuntimeTests.swift nuphos-ios/Models/NuphosUser.swift nuphos-ios/Models/Team.swift nuphos-ios/Services/LaunchCache.swift tests/LaunchCacheTests.swift nuphos-ios/Services/Chat/ComposerDrafts.swift tests/ChatRowTests.swift tests/ComposerDraftsTests.swift tests/CredentialScopeTests.swift tests/ComposerActionTests.swift tests/SessionLinkTests.swift tests/SessionMentionTests.swift tests/SidebarFavoritesTests.swift tests/ConversationNestingTests.swift tests/TaskFollowsBotTests.swift tests/ResourceStripTests.swift tests/StreamBacklogTests.swift tests/SSEClientTests.swift tests/StreamingMarkdownTests.swift tests/MessagePreviewTests.swift nuphos-ios/Services/Chat/MarkdownImages.swift tests/MarkdownImagesTests.swift nuphos-ios/Services/Chat/BareURL.swift tests/BareURLTests.swift tests/LocalAgentTests.swift nuphos-ios/Services/SignInSessions.swift tests/SignInSessionsTests.swift Shared/TurnActivityAttributes.swift tests/LiveActivityCardTests.swift tests/RuntimeObservationTests.swift nuphos-ios/Services/Chat/ResumeFallback.swift tests/ResumeFallbackTests.swift nuphos-ios/Services/Chat/DockDestination.swift tests/DockDestinationTests.swift -o "$test_dir/runtime-tests"
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
swiftc nuphos-ios/Views/Home/NewBox.swift tests/NewBoxTests.swift -o "$test_dir/new-box-tests"
"$test_dir/new-box-tests"
swiftc tests/StringCatalogTests.swift -o "$test_dir/string-catalog-tests"
"$test_dir/string-catalog-tests" Shared/Localizable.xcstrings
"$test_dir/string-catalog-tests" nuphos-ios/InfoPlist.xcstrings
# A chat's real read builds against UIKit: as Mac Catalyst, it runs here without a simulator.
macos_sdk=$(xcrun --sdk macosx --show-sdk-path)
chat_sources=(
  BotAvatars/BotAvatars.swift \
  nuphos-ios/Services/Chat/ThreadReference.swift \
  nuphos-ios/Services/ImageAttachment.swift \
  nuphos-ios/Services/PastedFile.swift \
  nuphos-ios/Services/Chat/JSONValue.swift \
  nuphos-ios/Services/Chat/RuntimeObservation.swift \
  nuphos-ios/Services/Chat/ConversationUnread.swift \
  nuphos-ios/Services/Chat/ChatModels.swift \
  nuphos-ios/Services/NuphosAPIBase.swift \
  nuphos-ios/Services/Chat/ToolRuns.swift \
  Shared/SessionLink.swift \
  nuphos-ios/Models/Channel.swift \
  nuphos-ios/Views/Home/ChatTime.swift \
  nuphos-ios/Services/Chat/TransferDownloads.swift \
  nuphos-ios/Services/Chat/MarkdownImages.swift \
  nuphos-ios/Models/AgentConversation.swift \
  nuphos-ios/Services/ConversationNesting.swift \
  nuphos-ios/Services/Chat/BotQuestions.swift \
  nuphos-ios/Models/CredentialCatalog.swift \
  nuphos-ios/Models/AgentRuntime.swift \
  nuphos-ios/Models/NuphosUser.swift \
  nuphos-ios/Models/Team.swift \
  nuphos-ios/Services/SignInSessions.swift \
  nuphos-ios/Services/NuphosAPI.swift \
  nuphos-ios/Services/WorkspaceAPI.swift \
  nuphos-ios/Services/Chat/OpenQuestions.swift \
  nuphos-ios/Services/BotFaces.swift \
  nuphos-ios/Services/Chat/AgentChatAPI.swift \
  nuphos-ios/Views/Home/ComposerAttachment.swift \
  nuphos-ios/Services/AccountAPI.swift \
  nuphos-ios/Models/TeamMember.swift \
  nuphos-ios/Services/StepUp.swift \
  nuphos-ios/Views/Home/LucideIcon.swift \
  nuphos-ios/Views/Theme.swift \
  nuphos-ios/Services/Passkeys.swift \
  nuphos-ios/Services/Chat/SSEClient.swift \
  nuphos-ios/Services/Chat/ChannelSession.swift)
for chat_test in CancelledLoadTests ChannelPushTests; do
  swiftc -target arm64-apple-ios18.0-macabi -sdk "$macos_sdk" -Fsystem "$macos_sdk/System/iOSSupport/System/Library/Frameworks" \
    -I "$macos_sdk/System/iOSSupport/usr/lib/swift" -L "$macos_sdk/System/iOSSupport/usr/lib/swift" -parse-as-library -default-isolation MainActor \
    "${chat_sources[@]}" "tests/$chat_test.swift" -o "$test_dir/$chat_test"
  "$test_dir/$chat_test"
done

swiftc BotAvatars/BotAvatars.swift tests/HostedBotAvatarTests.swift -o "$test_dir/hosted-bot-avatar-tests"
"$test_dir/hosted-bot-avatar-tests"
