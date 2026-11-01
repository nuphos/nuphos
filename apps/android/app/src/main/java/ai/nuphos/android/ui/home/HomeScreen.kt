package ai.nuphos.android.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.semantics.selected
import ai.nuphos.android.model.ConversationSort
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Assignment
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.FilterList
import androidx.compose.material.icons.rounded.MonitorHeart
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.material3.Checkbox
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.layout.ListDetailPaneScaffold
import androidx.compose.material3.adaptive.layout.PaneAdaptedValue
import androidx.compose.material3.adaptive.layout.ThreePaneScaffoldValue
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import ai.nuphos.android.ui.agent.NewChatComposer
import androidx.navigation.navArgument
import ai.nuphos.android.model.ConversationScope
import ai.nuphos.android.model.HomePage
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.data.WorkspaceApi
import ai.nuphos.android.session.WorkspaceSetupStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.ui.workspace.WorkspaceSetupSheet
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.PlansStore
import ai.nuphos.android.session.ConnectorsStore
import ai.nuphos.android.session.ConnectorIntents
import ai.nuphos.android.ui.LocalConnectorsStore
import ai.nuphos.android.ui.connectors.ConnectorsPage
import kotlinx.coroutines.delay
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.LocalPlansStore
import ai.nuphos.android.ui.agent.AgentPage
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.components.NuphosAvatar
import ai.nuphos.android.ui.plans.PlanDetailScreen
import ai.nuphos.android.ui.plans.PlansPage
import ai.nuphos.android.ui.profile.ProfileSheet
import ai.nuphos.android.ui.login.SplashScreen

@OptIn(androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun HomeRoute(
    user: NuphosUser,
    agentStore: AgentStore,
    plansStore: PlansStore,
    connectorsStore: ConnectorsStore,
) {
    val shareDrafts = (LocalContext.current.applicationContext as ai.nuphos.android.NuphosApplication).incomingShares
    val membershipAuth = LocalAuthSession.current
    // Keep the controller registered for Activity state restoration while memberships load.
    val nav = rememberNavController()
    val newChatComposer = remember(nav) { movableContentOf { NewChatComposer(nav) } }
    LaunchedEffect(agentStore) {
        val generation = membershipAuth.generation
        val token = membershipAuth.token
        val access = AiAccess.bind(token.orEmpty())
        agentStore.loadTeams {
            if (membershipAuth.generation == generation && membershipAuth.token == token && access())
                membershipAuth.signOut(NuphosApi.Failure.Unauthorized.message)
        }
    }
    val token = LocalAuthSession.current.token.orEmpty()
    CompositionLocalProvider(
        LocalAgentStore provides agentStore,
        LocalPlansStore provides plansStore,
        LocalConnectorsStore provides connectorsStore,
    ) {
        LaunchedEffect(agentStore.selectedTeam) { connectorsStore.select(agentStore.selectedTeam) }
        LaunchedEffect(connectorsStore, connectorsStore.team?.id) {
            if (connectorsStore.team != null) ConnectorIntents.callback.collect { uri ->
                if (uri != null) {
                    ConnectorIntents.callback.value = null
                    connectorsStore.handleCallback(uri)
                }
            }
        }
        LaunchedEffect(connectorsStore) {
            while (true) { delay(1000); connectorsStore.expire() }
        }
        // Keep NavHost attached during membership loading so restored entries receive lifecycle events.
        // Defer team-bound screens and link resolution until the selected workspace is known.
        val membershipsLoading = agentStore.selectedTeam == null &&
            agentStore.teamsPhase in setOf(AgentStore.Phase.Idle, AgentStore.Phase.Loading)
        val links = (LocalContext.current.applicationContext as ai.nuphos.android.NuphosApplication).conversationLinks
        val pendingLink by links.value.collectAsState()
        var linkError by remember(token, user.id) { mutableStateOf<String?>(null) }
        LaunchedEffect(pendingLink, token, user.id, membershipAuth.generation, membershipAuth.aiAllowed, agentStore.workspaceRevision, membershipsLoading) {
            if (membershipsLoading) return@LaunchedEffect
            val request = pendingLink ?: return@LaunchedEffect
            if (!membershipAuth.aiAllowed || membershipAuth.user?.id != user.id) return@LaunchedEffect
            val generation = membershipAuth.generation
            val workspaceRevision = agentStore.workspaceRevision
            val access = AiAccess.bind(token)
            fun current() = membershipAuth.generation == generation && membershipAuth.token == token &&
                membershipAuth.user?.id == user.id && access() && links.value.value == request &&
                agentStore.workspaceRevision == workspaceRevision
            linkError = null
            try {
                val resolved = ai.nuphos.android.session.ConversationLinkAccess(
                    memberships = { WorkspaceApi(token).memberships() },
                    teamId = { team: ai.nuphos.android.model.Team -> team.id },
                    conversation = { destination ->
                        NuphosApi.conversationDetail(token, destination.teamId, destination.conversationId)
                    },
                ).resolve(request.destination, ::current)
                // Navigation and workspace mutations require the Android main thread.
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main.immediate) {
                    if (!current()) return@withContext
                    if (resolved == null) {
                        links.complete(request)
                        linkError = "This agent is unavailable or your account does not have access."
                    } else if (agentStore.acceptMemberships(resolved.first, resolved.second.id)) {
                        nav.navigate("conversation/${android.net.Uri.encode(request.destination.conversationId)}") {
                            popUpTo("home")
                            launchSingleTop = true
                        }
                        links.complete(request)
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main.immediate) {
                    if (current()) {
                        if (e is NuphosApi.Failure.Unauthorized || (e is NuphosApi.Failure.Http && e.code in setOf(403, 404))) {
                            val key = ai.nuphos.android.session.ComposerDrafts.Key(user.id, request.destination.teamId,
                                ai.nuphos.android.session.ComposerDrafts.Destination.Chat(request.destination.conversationId))
                            shareDrafts.drop(key)
                        }
                        if (!current()) return@withContext
                        linkError = when (e) {
                            is NuphosApi.Failure.Unauthorized -> "Sign-in has expired. Sign in again to open this agent."
                            is NuphosApi.Failure.Http -> if (e.code == 403 || e.code == 404)
                                "This agent is unavailable or your account does not have access."
                                else "We could not open this agent. Please try the link again."
                            else -> "We could not open this agent. Check your connection and try the link again."
                        }
                        // Completing this request cancels its LaunchedEffect; do it after the awaited cleanup and error update.
                        links.complete(request)
                    }
                }
            }
        }
        linkError?.let { message ->
            AlertDialog(onDismissRequest = { linkError = null }, title = { Text("Could not open agent") },
                text = { Text(message) }, confirmButton = { TextButton(onClick = { linkError = null }) { Text("OK") } })
        }
        val notifications = (LocalContext.current.applicationContext as ai.nuphos.android.NuphosApplication).localNotifications
        val notificationAuth = LocalAuthSession.current
        ai.nuphos.android.notifications.NotificationNavigationEffect(notifications.pending,
            notificationAuth.user?.id, agentStore.selectedTeam?.id, notificationAuth.aiAllowed) { target ->
            nav.navigate("conversation/${android.net.Uri.encode(target.sessionId)}") { launchSingleTop = true }
        }
        ai.nuphos.android.ui.chat.IncomingShareSheet(nav)
        val entry by nav.currentBackStackEntryAsState()
        val showingDetail = entry?.destination?.route?.let { it != "home" } == true
        val info = currentWindowAdaptiveInfoV2()
        val wide = info.windowSizeClass.isWidthAtLeastBreakpoint(600)
        LaunchedEffect(showingDetail) {
            if (!showingDetail && !membershipsLoading) agentStore.refreshOnResume()
        }
        AdaptiveHomePanes(
            wide = wide,
            showingDetail = showingDetail,
            listPane = {
                Box(Modifier.fillMaxSize()) {
                    if (membershipsLoading) SplashScreen()
                    else HomeScreen(user, nav,
                        showComposer = !wide,
                        selectedSessionId = entry?.arguments?.getString("id"), newChatComposer = newChatComposer)
                }
            },
            detailPane = {
                NavHost(nav, startDestination = "home") {
                    composable("home") {
                        if (wide && !membershipsLoading) Column(Modifier.fillMaxSize().safeDrawingPadding().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = 720.dp)) {
                            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                                Text("Start a new agent", style = MaterialTheme.typography.headlineSmall)
                            }
                            newChatComposer()
                        }
                    }
                    composable(
                        "conversation/{id}?fresh={fresh}",
                        arguments = listOf(
                            navArgument("id") { type = NavType.StringType },
                            navArgument("fresh") { type = NavType.BoolType; defaultValue = false },
                        ),
                    ) { entry ->
                        val id = entry.arguments?.getString("id").orEmpty()
                        val fresh = entry.arguments?.getBoolean("fresh") == true
                        if (membershipsLoading) SplashScreen()
                        else ConversationScreen(sessionId = id, fresh = fresh, onBack = { nav.popBackStack("home", false) }, nav = nav,
                            newChat = wide)
                    }
                    composable("plan/{id}") { entry ->
                        val id = entry.arguments?.getString("id").orEmpty()
                        if (membershipsLoading) SplashScreen()
                        else PlanDetailScreen(planId = id, nav = nav, teamId = agentStore.selectedTeam?.id)
                    }
                    // Compatibility only: old run links remain read-only; no trigger-management UI is wired.
                    composable(
                        "trigger-run/{id}?teamId={teamId}",
                        arguments = listOf(
                            navArgument("id") { type = NavType.StringType },
                            navArgument("teamId") { type = NavType.StringType },
                        ),
                    ) { entry ->
                        if (membershipsLoading) SplashScreen()
                        else ConversationScreen(
                            sessionId = entry.arguments?.getString("id").orEmpty(),
                            fresh = false,
                            onBack = { nav.popBackStack() },
                            nav = nav,
                            browsingOnly = true,
                            browsingTeamId = entry.arguments?.getString("teamId"),
                        )
                    }
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HomeScreen(
    user: NuphosUser,
    nav: NavHostController,
    showComposer: Boolean = true,
    selectedSessionId: String? = null,
    newChatComposer: @Composable () -> Unit = { NewChatComposer(nav) },
) {
    val store = LocalAgentStore.current
    val plans = LocalPlansStore.current
    var page by rememberSaveable { mutableStateOf(HomePage.Agent.route) }
    val shares = (LocalContext.current.applicationContext as ai.nuphos.android.NuphosApplication).incomingShares
    val shared by shares.state.collectAsState()
    LaunchedEffect(shared?.id, shared?.destination) {
        if (shared?.destination?.destination == ai.nuphos.android.session.ComposerDrafts.Destination.NewChat) page = HomePage.Agent.route
    }
    val current = HomePage.fromRoute(page)
    val unavailablePage = HomePage.unavailableRoute(page)
    var searching by rememberSaveable { mutableStateOf(false) }
    var showProfile by remember { mutableStateOf(false) }
    var showSetup by remember { mutableStateOf(false) }
    val auth = LocalAuthSession.current
    val setupScope = rememberCoroutineScope()
    var setupEpoch by remember { mutableStateOf(0L) }
    val setup = remember(store, auth.generation, auth.token, AiAccess.revision, setupEpoch) {
        val accountGeneration = auth.generation
        val token = auth.token.orEmpty()
        val access = AiAccess.bind(token)
        var workspaceRevision = store.workspaceRevision
        val current = { auth.generation == accountGeneration && auth.token == token && auth.user?.id == user.id &&
            access() && store.workspaceRevision == workspaceRevision }
        WorkspaceSetupStore(WorkspaceApi(token), setupScope, current,
            { saved, selected ->
                if (!current()) false else {
                    val accepted = store.acceptMemberships(saved, selected?.id)
                    if (accepted) workspaceRevision = store.workspaceRevision
                    accepted
                }
            }, { if (current()) auth.signOut(NuphosApi.Failure.Unauthorized.message) }, auth.workspaceWriteReview)
    }
    DisposableEffect(setup) { onDispose { setup.close() } }
    LaunchedEffect(store.workspaceRevision, auth.generation, auth.token, AiAccess.revision) {
        if (!setup.isSourceCurrent()) {
            setup.close()
            showSetup = false
            if (auth.aiAllowed && auth.user?.id == user.id) setupEpoch++
        }
    }


    LaunchedEffect(store.selectedTeam?.id) {
        plans.use(store.selectedTeam?.id)
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                title = {
                    if (unavailablePage) Text("Page unavailable") else PageSwitcher(selected = current, onSelect = {
                        if (it != current) {
                            if (current == HomePage.Agent) store.updateSearch("")
                            if (current == HomePage.Plans) plans.search = ""
                            page = it.route; searching = false
                        }
                    })

                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                actions = {
                    if (current == HomePage.Agent || current == HomePage.Plans) {
                        IconButton(onClick = { searching = !searching }, modifier = Modifier.testTag("home-search")) {
                            Icon(Icons.Outlined.Search, contentDescription = "Search")
                        }
                        FilterButton(current)
                    }
                    FilledIconButton(
                        onClick = { showProfile = true },
                        modifier = Modifier.semantics { contentDescription = "Profile" },
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        ),
                    ) {
                        NuphosAvatar(user, size = 28.dp)
                    }
                    Spacer(Modifier.width(8.dp))
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding),
        ) {
            if (store.selectedTeam == null && store.teamsPhase == AgentStore.Phase.Loaded) {
                Column(Modifier.fillMaxWidth().weight(1f).padding(20.dp), verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Choose or set up a workspace to get started.")
                    Button(onClick = { showSetup = true }, modifier = Modifier.padding(top = 12.dp)) { Text("Set up a workspace") }
                }
            } else if (unavailablePage) {
                Column(Modifier.weight(1f).fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.Center) {
                    Text("This page is no longer available in the mobile app.", style = MaterialTheme.typography.titleMedium)
                    Button(onClick = { page = HomePage.Agent.route; searching = false }, modifier = Modifier.padding(top = 16.dp)) { Text("Back to Agents") }
                }
            } else AnimatedContent(current, modifier = Modifier.weight(1f), label = "page") { dest ->
                when (dest) {
                    HomePage.Agent -> AgentPage(searching = searching, onSearchingChange = { searching = it }, nav = nav, showComposer = showComposer, selectedSessionId = selectedSessionId, newChatComposer = newChatComposer)
                    HomePage.Runtimes -> ai.nuphos.android.ui.agent.RuntimesPage()
                    HomePage.Plans -> PlansPage(searching = searching, onSearchingChange = { searching = it }, nav = nav)
                    HomePage.Connectors -> ConnectorsPage()

                }
            }
        }
    }
    if (showSetup) WorkspaceSetupSheet(setup) { showSetup = false }
    if (showProfile) {
        ProfileSheet(user = user, onDismiss = { showProfile = false }, workspaceName = store.selectedTeam?.name,
            workspacePicker = { back ->
                ai.nuphos.android.ui.profile.WorkspacePickerContent(
                    teams = store.teams,
                    selectedId = store.selectedTeam?.id,
                    onBack = back,
                    onSelect = { team ->
                        // Membership and generation validation remain in AgentStore.select.
                        setup.close(); showSetup = false
                        if (store.selectedTeam?.id != team.id) nav.popBackStack("home", false)
                        store.select(team)
                        back()
                    },
                    onSetup = { back(); showProfile = false; showSetup = true },
                )
            })
    }
}

@Composable
internal fun PageSwitcher(
    selected: HomePage,
    onSelect: (HomePage) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val anchorFocus = remember { FocusRequester() }
    var restoreFocus by remember { mutableStateOf(false) }
    LaunchedEffect(expanded) {
        if (!expanded && restoreFocus) {
            androidx.compose.runtime.withFrameNanos { }
            anchorFocus.requestFocus()
            restoreFocus = false
        }
    }
    fun dismiss() { restoreFocus = true; expanded = false }
    Box(modifier) {
        TextButton(
            onClick = { expanded = true },
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
            modifier = Modifier.heightIn(min = 48.dp).focusRequester(anchorFocus).testTag("home-page-switcher")
                .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
        ) {
            Text(selected.title, style = MaterialTheme.typography.headlineSmall,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Outlined.ExpandMore, contentDescription = null)
        }
        DropdownMenu(expanded, onDismissRequest = ::dismiss, modifier = Modifier.testTag("home-page-menu")) {
            HomePage.entries.forEach { page ->
                DropdownMenuItem(
                    text = { Text(page.title) },
                    modifier = Modifier.testTag("home-page-${page.route}").semantics { this.selected = selected == page },
                    leadingIcon = {
                        if (selected == page) Icon(Icons.Outlined.Check, contentDescription = null)
                        else Spacer(Modifier.size(24.dp))
                    },
                    onClick = { dismiss(); onSelect(page) },
                )
            }
        }
    }
}

private fun HomePage.icon(selected: Boolean): ImageVector = when (this) {
    HomePage.Agent -> if (selected) Icons.Rounded.AutoAwesome else Icons.Outlined.AutoAwesome
    HomePage.Runtimes -> Icons.Outlined.Computer
    HomePage.Plans -> if (selected) Icons.Rounded.Assignment else Icons.Outlined.Assignment
    HomePage.Connectors -> if (selected) Icons.Rounded.Link else Icons.Outlined.Link
}

@Composable
internal fun FilterButton(page: HomePage) {
    val store = LocalAgentStore.current
    val plans = LocalPlansStore.current
    var expanded by remember { mutableStateOf(false) }
    val active = if (page == HomePage.Agent) store.scope != ConversationScope.Mine || store.archivedOnly || store.sort != ConversationSort.Created else plans.showDismissed
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.testTag("home-filter").semantics { stateDescription = if (active) "Filters applied" else "Default filters" }) {
            Icon(
                if ((page == HomePage.Agent && (store.scope != ConversationScope.Mine || store.archivedOnly || store.sort != ConversationSort.Created)) ||
                    (page == HomePage.Plans && plans.showDismissed)
                ) Icons.Rounded.FilterList else Icons.Outlined.FilterList,
                contentDescription = if (page == HomePage.Agent) "Filter agents" else "Filter",
            )
        }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            if (page == HomePage.Agent) {
                DropdownMenuItem(
                    text = { Text("My agents") },
                    modifier = Modifier.semantics { selected = store.scope == ConversationScope.Mine },
                    leadingIcon = { if (store.scope == ConversationScope.Mine) Icon(Icons.Outlined.Check, null) else Spacer(Modifier.size(24.dp)) },
                    onClick = { store.updateScope(ConversationScope.Mine); expanded = false },
                )
                DropdownMenuItem(
                    text = { Text("Team agents") },
                    modifier = Modifier.semantics { selected = store.scope == ConversationScope.Team },
                    leadingIcon = { if (store.scope == ConversationScope.Team) Icon(Icons.Outlined.Check, null) else Spacer(Modifier.size(24.dp)) },
                    onClick = { store.updateScope(ConversationScope.Team); expanded = false },
                )
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Sort") }, onClick = {}, enabled = false)
                ConversationSort.entries.forEach { order ->
                    DropdownMenuItem(
                        text = { Text(order.title) },
                        modifier = Modifier.semantics { selected = store.sort == order },
                        leadingIcon = {
                            if (store.sort == order) Icon(Icons.Outlined.Check, contentDescription = null)
                            else Spacer(Modifier.size(24.dp))
                        },
                        onClick = { store.updateSort(order); expanded = false },
                    )
                }
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("Archived") },
                    modifier = Modifier.testTag("filter-archived").semantics {
                        toggleableState = if (store.archivedOnly) ToggleableState.On else ToggleableState.Off
                        role = Role.Checkbox
                    },
                    leadingIcon = { Checkbox(store.archivedOnly, onCheckedChange = null, modifier = Modifier.clearAndSetSemantics { }) },
                    onClick = { store.updateArchivedOnly(!store.archivedOnly); expanded = false },
                )
            } else {
                DropdownMenuItem(
                    text = { Text("Show dismissed") },
                    onClick = { plans.showDismissed = !plans.showDismissed; expanded = false },
                )
            }
        }
    }
}

@Composable
fun PlaceholderPage(page: HomePage) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(page.icon(true), contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Text(page.title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 16.dp))
        Text(
            "Coming soon to the Nuphos app.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@OptIn(androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi::class)
@Composable
internal fun AdaptiveHomePanes(
    wide: Boolean,
    showingDetail: Boolean,
    listPane: @Composable () -> Unit,
    detailPane: @Composable () -> Unit,
) {
    val directive = calculatePaneScaffoldDirective(currentWindowAdaptiveInfoV2()).copy(
        maxHorizontalPartitions = if (wide) 2 else 1,
        horizontalPartitionSpacerSize = 1.dp,
        defaultPanePreferredWidth = 320.dp,
    )
    val panes = ThreePaneScaffoldValue(
        primary = if (wide || showingDetail) PaneAdaptedValue.Expanded else PaneAdaptedValue.Hidden,
        secondary = if (wide || !showingDetail) PaneAdaptedValue.Expanded else PaneAdaptedValue.Hidden,
        tertiary = PaneAdaptedValue.Hidden,
    )
    // Keep the single NavHost composed even when its pane is hidden.
    ListDetailPaneScaffold(directive = directive, value = panes,
        listPane = { listPane() }, detailPane = { detailPane() })
}
