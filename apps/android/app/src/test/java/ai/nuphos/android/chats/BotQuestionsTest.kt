package ai.nuphos.android.chats

import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.AgentConversationsPage
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.DecisionQuestion
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.session.BotQuestions
import ai.nuphos.android.session.ChannelSession
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.chats.isLongBody
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class BotQuestionsTest {
    private fun row(id: String, parent: String? = null, owner: Boolean = true, vararg asks: Pair<String, String>) =
        AgentConversation(sessionId = id, title = id, isOwner = owner, parentSessionId = parent,
            inputRequests = asks.map { (requestId, at) -> InputRequest(requestId, "approval", "Ship?", listOf("Yes", "No"), at) }
                .ifEmpty { null })

    // The pending listing: rows that ask, then every parent above them, which ask nothing.
    private val listing = listOf(
        row("canary", "rollout", true, "q-canary" to "2026-11-09T03:03:00Z"),
        row("docs", "bot-1", true, "q-docs" to "2026-11-09T03:01:00Z"),
        row("bot-1", null, true, "q-bot" to "2026-11-09T03:02:00Z"),
        row("rollout", "bot-1"),
    )

    @Test fun listsTheBotsQuestionsAtAnyDepthOldestFirst() {
        val questions = BotQuestions.under("bot-1", listing)
        assertEquals(listOf("q-docs", "q-bot", "q-canary"), questions.map { it.request.id })
        assertEquals(listOf("docs", "bot-1", "canary"), questions.map { it.sessionId })
        assertEquals("https://nuphos.ai/teams/t1/agent/canary", questions.last().link("t1"))
    }

    @Test fun leavesOutOtherBotsTeammatesAndLoops() {
        val rows = listOf(
            row("elsewhere", "other-bot", true, "q-1" to "a"),
            row("theirs", "bot-1", false, "q-2" to "b"),
            row("orphan", "unlisted", true, "q-3" to "c"),
            row("loop-a", "loop-b", true, "q-4" to "d"), row("loop-b", "loop-a"),
        )
        assertTrue(BotQuestions.under("bot-1", rows).isEmpty())
    }

    @Test fun keepsTheBodyTheAgentWroteToDecideFrom() {
        val request = Http.json.decodeFromString(InputRequest.serializer(),
            """{"id":"q","question":"Direction OK?","body":"**Why:** see [#412](https://example.com/412)","status":"open"}""")
        assertEquals("**Why:** see [#412](https://example.com/412)", request.body)
        assertNull(Http.json.decodeFromString(InputRequest.serializer(), """{"id":"q","question":"Ship?"}""").body)
        // Up to three short lines show whole; more collapses behind "Show more".
        assertFalse(isLongBody("One finding.\nA second.\nA third."))
        assertTrue(isLongBody("1\n2\n3\n4"))
        assertTrue(isLongBody("x".repeat(241)))
    }

    @Test fun decodesTheOpenRequestsOfAListRowAndAsksForThem() {
        val page = Http.json.decodeFromString(AgentConversationsPage.serializer(), """
            {"conversations":[{"sessionId":"canary","parentSessionId":"rollout","isOwner":true,
              "inputRequests":[{"id":"q-canary","category":"approval","question":"Ship?","options":["Yes"],
              "askedAt":"2026-11-09T03:03:00Z","status":"open"}]}],
             "parents":[{"sessionId":"rollout","parentSessionId":"bot-1","isOwner":true}],"nextCursor":null,"hasMore":false}
        """)
        assertEquals(listOf("canary:q-canary"), BotQuestions.under("bot-1", page.rows).map { it.id })
        val query = NuphosApi.conversationQuery("team", pendingDecision = true).toMap()
        assertEquals("true", query["pendingDecision"])
        assertNull(NuphosApi.conversationQuery("team").toMap()["pendingDecision"])
    }

    private class FakeTransport : ChannelSession.Transport {
        var pending = listOf<AgentConversation>()
        /** (session, what was said, request), and the body each answer sent. */
        val answers = mutableListOf<Triple<String, String, String>>()
        val bodies = mutableListOf<JsonValue>()
        var failAnswer = false
        var faces = """[{"id":"bot-1","name":"Release Lead","agent":{"avatar":"05"}}]"""
        override suspend fun detail(tail: Int): AgentConversationDetail =
            Http.json.decodeFromString("""{"kind":"channel","title":"Release Lead","faces":$faces,"messages":[]}""")
        override suspend fun agents() = emptyList<ChannelAgent>()
        override suspend fun attachment(groupId: String) = TransferDownloadGroup(groupId, "2099-01-01T00:00:00Z", emptyList())
        override suspend fun upload(attachments: List<ComposerAttachment>) = "group"
        val posted = mutableListOf<Pair<String, String?>>()
        var failPost = false
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) {
            posted += text to replyTo
            if (failPost) throw NuphosApi.Failure.Http(500, "Synthetic post failure")
        }
        override suspend fun pending() = pending
        override suspend fun answer(sessionId: String, requestId: String, answer: JsonValue) {
            val fields = (answer as JsonValue.Obj).value
            val said = (fields["choices"] as? JsonValue.Arr)?.value?.firstOrNull() ?: fields["text"]
            answers += Triple(sessionId, (said as? JsonValue.Str)?.value.orEmpty(), requestId)
            bodies += answer
            if (failAnswer) throw NuphosApi.Failure.Http(500, "Synthetic answer failure")
        }
    }

    @Test fun anAnswerGoesToTheAskingConversationAndHidesTheCard() = runTest {
        val transport = FakeTransport().apply { pending = listing }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        session.refreshQuestions()
        val canary = session.questions.single { it.sessionId == "canary" }
        session.answer(canary, "Yes", this)
        assertFalse(session.questions.any { it.id == canary.id })
        testScheduler.advanceUntilIdle()
        assertEquals(listOf(Triple("canary", "Yes", "q-canary")), transport.answers)
        // An option is sent as the choice; no message is posted.
        assertEquals(JsonValue.obj("choices" to JsonValue.Arr(listOf(JsonValue.Str("Yes")))), transport.bodies.single())
        assertTrue(transport.posted.isEmpty())
        // Until the listing drops it, an answered question stays hidden.
        session.refreshQuestions()
        assertFalse(session.questions.any { it.id == canary.id })
        transport.pending = listing.filter { it.sessionId != "canary" }
        session.refreshQuestions()
        assertEquals(listOf("q-docs", "q-bot"), session.questions.map { it.request.id })
    }

    @Test fun anIntegrationIsAnsweredByTheConversationsWholeSelection() = runTest {
        val saved = mutableListOf<Pair<String, JsonValue>>()
        var failSave = false
        val source = object : OpenQuestions.Source {
            override suspend fun credentials(sessionId: String) = JsonValue.parse(
                """{"githubInstallationIds":["166"],"awsRoleIds":["r1"],"futureIds":["kept-by-the-server"]}""")
            override suspend fun saveCredentials(sessionId: String, access: JsonValue) {
                if (failSave) throw NuphosApi.Failure.Http(403, "Not yours")
                saved += sessionId to access
            }
        }
        val inbox = OpenQuestions(source)
        val ask = BotQuestion("agent-ops", "Release ops", InputRequest("q-gh", "integration", "Select your GitHub", null))
        val stored = requireNotNull(inbox.storedSelection(ask))
        // As the store loads it for the picker.
        val catalog = CredentialCatalog(JsonValue.parse("""{"personalCredentials":[{"provider":"github","login":"octocat"}]}""")!!,
            CredentialCatalog.NEW_CONVERSATION_PROVIDERS)
        inbox.select(stored.toggle(catalog.allItems.single()), ask)
        // Everything it had, plus the member's own GitHub; a key this build does not know is left to the server.
        val sent = saved.single().second
        assertEquals("agent-ops", saved.single().first)
        assertEquals(listOf("166"), sent["githubInstallationIds"]?.arrayValue?.mapNotNull { it.stringValue })
        assertEquals(listOf("r1"), sent["awsRoleIds"]?.arrayValue?.mapNotNull { it.stringValue })
        assertEquals(listOf("github"), sent["personalCredentialIds"]?.arrayValue?.mapNotNull { it.stringValue })
        assertNull(sent["futureIds"])
        // Refused, say why on the card.
        failSave = true
        inbox.select(stored, ask)
        assertNotNull(inbox.failures[ask.id])
        // A new chat never starts as the member.
        assertTrue(CredentialSelection().selectDefaults(catalog).ids["personalCredentialIds"].isNullOrEmpty())
    }

    @Test fun aQuestionNamingTheMembersOwnGithubIsAnsweredByThatAlone() = runTest {
        fun ask(json: String) = BotQuestion("agent-ops", "Release ops", Http.json.decodeFromString<InputRequest>(json))
        val own = ask("""{"id":"q-own","category":"integration","question":"Your GitHub","credentials":[{"provider":"personal","id":"github"}]}""")
        assertEquals(listOf("github"), own.personalCredentials)
        assertTrue(own.connectable)
        // Any access answers plain providers; a mix, or a team credential named, gets no card here.
        assertTrue(ask("""{"id":"q","category":"integration","question":"GitHub","providers":["github"]}""").connectable)
        assertFalse(ask("""{"id":"q","category":"integration","question":"?","providers":["github"],"credentials":[{"provider":"personal","id":"github"}]}""").connectable)
        assertFalse(ask("""{"id":"q","category":"integration","question":"?","credentials":[{"provider":"github","id":"166"}]}""").connectable)

        val saved = mutableListOf<JsonValue>()
        val inbox = OpenQuestions(object : OpenQuestions.Source {
            override suspend fun credentials(sessionId: String) = JsonValue.parse("""{"githubInstallationIds":["166"]}""")
            override suspend fun saveCredentials(sessionId: String, access: JsonValue) { saved += access }
        })
        // Credentials unreadable: said on the card, nothing saved.
        inbox.useOwn(listOf("github"), own, connected = null)
        assertTrue(saved.isEmpty())
        assertEquals("Couldn't load your credentials. Try again.", inbox.failures[own.id])
        // Not connected: said on the card, nothing saved.
        inbox.useOwn(listOf("github"), own, connected = emptySet())
        assertTrue(saved.isEmpty())
        assertNotNull(inbox.failures[own.id])
        // Connected: the conversation keeps its installation and gains the member's own GitHub, nothing else.
        inbox.useOwn(listOf("github"), own, connected = setOf("github"))
        assertEquals(listOf("166"), saved.single()["githubInstallationIds"]?.arrayValue?.mapNotNull { it.stringValue })
        assertEquals(listOf("github"), saved.single()["personalCredentialIds"]?.arrayValue?.mapNotNull { it.stringValue })
        assertNull(inbox.failures[own.id])
    }

    @Test fun anInboxSaveSendsOnlyTheKindsTheConversationHad() = runTest {
        val own = BotQuestion("agent-ops", "Release ops", Http.json.decodeFromString<InputRequest>(
            """{"id":"q-own","category":"integration","question":"?","credentials":[{"provider":"personal","id":"github"}]}"""))
        val saved = mutableListOf<JsonValue>()
        val inbox = OpenQuestions(object : OpenQuestions.Source {
            // No GitHub key: every installation. [] is none, null is unset, a string is malformed.
            override suspend fun credentials(sessionId: String) = JsonValue.parse(
                """{"awsRoleIds":["aws"],"gitlabBindingIds":[],"notionIntegrationIds":null,"grafanaInstanceIds":"bogus"}""")
            override suspend fun saveCredentials(sessionId: String, access: JsonValue) { saved += access }
        })
        inbox.useOwn(listOf("github"), own, connected = setOf("github"))
        val sent = (saved.single() as JsonValue.Obj).value
        // An unset kind stays unset rather than revoked as []; the empty one stays empty.
        assertEquals(setOf("awsRoleIds", "gitlabBindingIds", "grafanaInstanceIds", "personalCredentialIds"), sent.keys)
        assertEquals(emptyList<JsonValue>(), sent["gitlabBindingIds"]?.arrayValue)
        // Malformed fails closed: sent as none, never left out to mean "all".
        assertEquals(emptyList<JsonValue>(), sent["grafanaInstanceIds"]?.arrayValue)
        // A new conversation still states every kind.
        assertNotNull(CredentialSelection(newConversation = true).json["githubInstallationIds"])
    }

    @Test fun aPlanOrASecretIsNeverAnsweredInWords() {
        fun ask(category: String, planId: String? = null) =
            BotQuestion("s", "Agent", InputRequest("r", category, "Go?", listOf("Approve", "Reject"), planId = planId))
        assertTrue(ask("preference").typed)
        assertFalse(ask("approval", planId = "p1").typed)
        assertFalse(ask("credential").typed)
        assertFalse(ask("integration").typed)
        assertEquals("p1", Http.json.decodeFromString<InputRequest>("""{"id":"r","question":"Approve?","planId":"p1"}""").planId)
    }

    @Test fun theBotsOwnQuestionIsAnsweredThroughTheServerNotByAPost() = runTest {
        val transport = FakeTransport().apply { pending = listing }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        session.refreshQuestions()
        val own = session.questions.single { it.sessionId == "bot-1" }
        session.answer(own, "Done.", this)
        assertFalse(session.questions.any { it.id == own.id })
        testScheduler.advanceUntilIdle()
        assertEquals(listOf(Triple("bot-1", "Done.", "q-bot")), transport.answers)
        // Words that are not an option are sent as text.
        assertEquals(JsonValue.obj("text" to JsonValue.Str("Done.")), transport.bodies.single())
        assertTrue(transport.posted.isEmpty())
    }

    @Test fun aFailedAnswerBringsTheCardBack() = runTest {
        val transport = FakeTransport().apply { pending = listing; failAnswer = true }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        session.refreshQuestions()
        val docs = session.questions.single { it.sessionId == "docs" }
        session.answer(docs, "No", this)
        testScheduler.advanceUntilIdle()
        assertTrue(session.questions.any { it.id == docs.id })
        // Shown on the card, not as a dialog.
        assertNotNull(session.answerFailure(docs))
        assertNull(session.sendError)
        // Answering again clears it.
        transport.failAnswer = false
        session.answer(docs, "Yes", this)
        assertNull(session.answerFailure(docs))
    }

    @Test fun aChatThatIsNotABotsHasNoQuestions() = runTest {
        // A group chat: two people, no Bot.
        val transport = FakeTransport().apply {
            pending = listing
            faces = """[{"id":"u2","name":"Sam"},{"id":"u3","name":"Kim"}]"""
        }
        val session = ChannelSession("team", "chat-group", "Group", transport)
        session.refresh(force = true)
        session.refreshQuestions()
        assertTrue(session.questions.isEmpty())
    }

    @Test fun theInboxListsEveryOwnQuestionOnceAndAnswersIt() = runTest {
        val rows = listOf(
            row("deploy", "bot-1", true, "q-2" to "2026-11-09T03:02:00Z", "q-1" to "2026-11-09T03:01:00Z"),
            row("bot-1", null, true, "q-3" to "2026-11-09T03:03:00Z"),
            // Also listed as a parent: read once.
            row("deploy", "bot-1", true, "q-2" to "2026-11-09T03:02:00Z"),
            row("theirs", null, false, "q-4" to "2026-11-09T03:04:00Z"),
        )
        assertEquals(listOf("q-1", "q-2", "q-3"), BotQuestions.open(rows).map { it.request.id })

        val transport = FakeTransport().apply { pending = rows }
        val inbox = OpenQuestions(transport)
        inbox.refresh()
        assertTrue(inbox.loaded)
        val first = inbox.list.first()
        inbox.answer(first, "Ship it", this)
        assertFalse(inbox.list.any { it.id == first.id })
        testScheduler.advanceUntilIdle()
        assertEquals(listOf(Triple("deploy", "Ship it", "q-1")), transport.answers)
        assertTrue(inbox.failures.isEmpty())
    }

    // Several questions in one card, as the backend sends them: `body` ends with the questions written out.
    private val twoQuestions = Http.json.decodeFromString(InputRequest.serializer(), """
        {"id":"q-form","category":"preference","question":"Two things to settle",
         "body":"Context first.\n\n---\n\n**1. Send the draft?**\n- Send\n- Hold\n\n**2. Which regions?** (any number)\n- us\n- eu",
         "questions":[{"question":"Send the draft?","options":["Send","Hold"]},
                      {"question":"Which regions?","options":["us","eu"],"multiSelect":true}]}
    """)

    @Test fun aSeveralQuestionCardIsAFormWithoutTheWrittenOutList() {
        val question = BotQuestion("s", "Support", twoQuestions)
        assertEquals(listOf("Send the draft?", "Which regions?"), question.form?.map { it.question })
        assertEquals(true, question.form?.last()?.multiSelect)
        // The list the backend writes for clients without forms is dropped; the agent's own text stays.
        assertEquals("Context first.", question.ownBody)
    }

    @Test fun aMultiSelectQuestionIsAFormAndASingleChoiceKeepsItsOneTapOptions() {
        val many = InputRequest("q", "preference", "Which?", listOf("a", "b"), multiSelect = true)
        assertEquals(listOf(DecisionQuestion("Which?", listOf("a", "b"), true)), BotQuestion("s", "t", many).form)
        assertNull(BotQuestion("s", "t", InputRequest("q", "preference", "Which?", listOf("a", "b"))).form)
        // Never for a question only a connection or a plan answers.
        assertNull(BotQuestion("s", "t", many.copy(category = "integration")).form)
        assertNull(BotQuestion("s", "t", many.copy(planId = "p")).form)
    }

    @Test fun anAgentsOwnSeparatorStaysInTheBody() {
        val request = twoQuestions.copy(body = "Mine\n\n---\n\nStill mine")
        assertEquals("Mine\n\n---\n\nStill mine", BotQuestion("s", "t", request).ownBody)
    }

    @Test fun theFormSendsOneAnswerPerQuestionAsDesktopDoes() {
        val questions = twoQuestions.questions!!
        val answer = BotQuestion.formAnswer(questions, listOf(listOf("Send"), listOf("us", "eu")), listOf("", ""))
        assertEquals("""{"questions":[{"choices":["Send"]},{"choices":["us","eu"]}]}""", answer.compact)
        // Typed words take the place of the picks; one question is answered on its own.
        assertEquals("""{"questions":[{"text":"Hold until Monday"},{"choices":["eu"]}]}""",
            BotQuestion.formAnswer(questions, listOf(listOf("Send"), listOf("eu")), listOf(" Hold until Monday ", "")).compact)
        assertEquals("""{"choices":["a","b"]}""",
            BotQuestion.formAnswer(listOf(DecisionQuestion("Which?", listOf("a", "b"), true)), listOf(listOf("a", "b")), listOf("")).compact)
        assertEquals("Send, Hold", BotQuestion.answerText(listOf("Send", "Hold"), "  "))
    }

    @Test fun aFormAnswerIsSentAsBuiltAndHidesTheCard() = runTest {
        val transport = FakeTransport().apply {
            pending = listOf(AgentConversation(sessionId = "s", title = "Support", isOwner = true, inputRequests = listOf(twoQuestions)))
        }
        val inbox = OpenQuestions(transport)
        inbox.refresh()
        val card = inbox.list.single()
        val body = BotQuestion.formAnswer(card.form!!, listOf(listOf("Hold"), listOf("us")), listOf("", ""))
        inbox.answer(card, body, this)
        assertTrue(inbox.list.isEmpty())
        testScheduler.advanceUntilIdle()
        assertEquals(listOf(body), transport.bodies)
        assertTrue(inbox.failures.isEmpty())
    }
}
