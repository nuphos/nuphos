package ai.nuphos.android.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Assignment
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.FilterList
import androidx.compose.material.icons.rounded.MonitorHeart
import androidx.compose.material3.ButtonGroupDefaults
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
import androidx.compose.material3.ToggleButton
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import ai.nuphos.android.model.ConversationScope
import ai.nuphos.android.model.HomePage
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.data.BrowsingApi
import ai.nuphos.android.data.WorkspaceApi
import ai.nuphos.android.session.WorkspaceSetupStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.ui.workspace.WorkspaceSetupSheet
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.session.MonitoringStore
import ai.nuphos.android.session.TriggersStore
import ai.nuphos.android.session.TriggerRunsStore
import ai.nuphos.android.ui.monitoring.MonitoringPage
import ai.nuphos.android.ui.triggers.TriggersPage
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

@Composable
fun HomeRoute(
    user: NuphosUser,
    agentStore: AgentStore,
    plansStore: PlansStore,
    connectorsStore: ConnectorsStore,
) {
    val membershipAuth = LocalAuthSession.current
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
    val transport = remember(token) { BrowsingApi(token) }
    val monitoring = remember(token) { MonitoringStore(transport) }
    val triggers = remember(token) { TriggersStore(transport) }
    val triggerRuns = remember(token) {
        TriggerRunsStore { team, trigger, cursor ->
            NuphosApi.conversations(token, team, cursor = cursor, scope = ConversationScope.Team, triggerId = trigger)
        }
    }
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
        // Resolve the selected team before restoring a team-bound destination.
        if (agentStore.selectedTeam == null && agentStore.teamsPhase in setOf(AgentStore.Phase.Idle, AgentStore.Phase.Loading)) {
            SplashScreen()
            return@CompositionLocalProvider
        }
        val nav = rememberNavController()
        val notifications = (LocalContext.current.applicationContext as ai.nuphos.android.NuphosApplication).localNotifications
        val pendingNotification by notifications.pending.value.collectAsState()
        val notificationAuth = LocalAuthSession.current
        val notificationAiAllowed = notificationAuth.aiAllowed
        LaunchedEffect(pendingNotification, user.id, agentStore.selectedTeam?.id, notificationAiAllowed) {
            val target = notifications.pending.take(notificationAuth.user?.id, agentStore.selectedTeam?.id, notificationAuth.aiAllowed)
            if (target != null) nav.navigate("trigger-run/${android.net.Uri.encode(target.sessionId)}?teamId=${android.net.Uri.encode(target.teamId)}") { launchSingleTop = true }
        }
        NavHost(nav, startDestination = "home") {
            composable("home") { HomeScreen(user, nav, monitoring, triggers, triggerRuns) }
            composable(
                "conversation/{id}?fresh={fresh}",
                arguments = listOf(
                    navArgument("id") { type = NavType.StringType },
                    navArgument("fresh") { type = NavType.BoolType; defaultValue = false },
                ),
            ) { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                val fresh = entry.arguments?.getBoolean("fresh") == true
                ConversationScreen(sessionId = id, fresh = fresh, onBack = { nav.popBackStack() }, nav = nav)
            }
            composable("plan/{id}") { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                PlanDetailScreen(planId = id, nav = nav, teamId = agentStore.selectedTeam?.id)
            }
            composable(
                "trigger-run/{id}?teamId={teamId}",
                arguments = listOf(
                    navArgument("id") { type = NavType.StringType },
                    navArgument("teamId") { type = NavType.StringType },
                ),
            ) { entry ->
                ConversationScreen(
                    sessionId = entry.arguments?.getString("id").orEmpty(),
                    fresh = false,
                    onBack = { nav.popBackStack() },
                    nav = nav,
                    browsingOnly = true,
                    browsingTeamId = entry.arguments?.getString("teamId"),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HomeScreen(
    user: NuphosUser,
    nav: NavHostController,
    monitoring: MonitoringStore,
    triggers: TriggersStore,
    triggerRuns: TriggerRunsStore,
) {
    val store = LocalAgentStore.current
    val plans = LocalPlansStore.current
    var page by rememberSaveable { mutableStateOf(HomePage.Agent.route) }
    val current = HomePage.fromRoute(page)
    var searching by rememberSaveable { mutableStateOf(false) }
    var showProfile by remember { mutableStateOf(false) }
    var showWorkspaces by remember { mutableStateOf(false) }
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
                    TextButton(onClick = { showWorkspaces = true }) { Text(store.selectedTeam?.name ?: "Choose workspace", maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
                    DropdownMenu(showWorkspaces, onDismissRequest = { showWorkspaces = false }) {
                        store.teams.forEach { team ->
                            DropdownMenuItem(text = { Text(team.name) }, onClick = {
                                setup.close(); showSetup = false; store.select(team); showWorkspaces = false
                            })
                        }
                        DropdownMenuItem(text = { Text("Set up a workspace") }, onClick = { showWorkspaces = false; showSetup = true })
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                actions = {
                    if (current == HomePage.Agent || current == HomePage.Plans) {
                        IconButton(onClick = { searching = !searching }) {
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
            Text(
                current.title,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
            )
            PageSwitcher(
                selected = current,
                onSelect = {
                    page = it.route
                    searching = false
                },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            if (store.selectedTeam == null && store.teamsPhase == AgentStore.Phase.Loaded) {
                Column(Modifier.fillMaxWidth().weight(1f).padding(20.dp), verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Choose or set up a workspace to get started.")
                    Button(onClick = { showSetup = true }, modifier = Modifier.padding(top = 12.dp)) { Text("Set up a workspace") }
                }
            } else AnimatedContent(current, modifier = Modifier.weight(1f), label = "page") { dest ->
                when (dest) {
                    HomePage.Agent -> AgentPage(searching = searching, onSearchingChange = { searching = it }, nav = nav)
                    HomePage.Plans -> PlansPage(searching = searching, onSearchingChange = { searching = it }, nav = nav)
                    HomePage.Connectors -> ConnectorsPage()
                    HomePage.Monitoring -> MonitoringPage(monitoring, store.selectedTeam?.id, onOpenConnectors = { page = HomePage.Connectors.route })
                    HomePage.Triggers -> TriggersPage(triggers, triggerRuns, store.selectedTeam?.id, onOpenRun = { sessionId, teamId ->
                        nav.navigate("trigger-run/${android.net.Uri.encode(sessionId)}?teamId=${android.net.Uri.encode(teamId)}")
                    })
                }
            }
        }
    }
    if (showSetup) WorkspaceSetupSheet(setup) { showSetup = false }
    if (showProfile) {
        ProfileSheet(user = user, onDismiss = { showProfile = false })
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun PageSwitcher(
    selected: HomePage,
    onSelect: (HomePage) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween),
    ) {
        HomePage.entries.forEachIndexed { index, page ->
            val shapes = when (index) {
                0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                HomePage.entries.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
            }
            ToggleButton(
                checked = selected == page,
                onCheckedChange = { onSelect(page) },
                shapes = shapes,
                modifier = Modifier.weight(1f),
            ) {
                Icon(page.icon(selected == page), contentDescription = page.title, modifier = Modifier.size(18.dp))
            }
        }
    }
}

private fun HomePage.icon(selected: Boolean): ImageVector = when (this) {
    HomePage.Agent -> if (selected) Icons.Rounded.AutoAwesome else Icons.Outlined.AutoAwesome
    HomePage.Monitoring -> if (selected) Icons.Rounded.MonitorHeart else Icons.Outlined.MonitorHeart
    HomePage.Triggers -> if (selected) Icons.Rounded.Bolt else Icons.Outlined.Bolt
    HomePage.Plans -> if (selected) Icons.Rounded.Assignment else Icons.Outlined.Assignment
    HomePage.Connectors -> if (selected) Icons.Rounded.Link else Icons.Outlined.Link
}

@Composable
private fun FilterButton(page: HomePage) {
    val store = LocalAgentStore.current
    val plans = LocalPlansStore.current
    var expanded by remember { mutableStateOf(false) }
    IconButton(onClick = { expanded = true }) {
        Icon(
            if ((page == HomePage.Agent && store.scope != ConversationScope.Mine) ||
                (page == HomePage.Plans && plans.showDismissed)
            ) Icons.Rounded.FilterList else Icons.Outlined.FilterList,
            contentDescription = "Filter",
        )
    }
    DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
        if (page == HomePage.Agent) {
            DropdownMenuItem(
                text = { Text("My chats") },
                onClick = { store.updateScope(ConversationScope.Mine); expanded = false },
            )
            DropdownMenuItem(
                text = { Text("Team chats") },
                onClick = { store.updateScope(ConversationScope.Team); expanded = false },
            )
        } else {
            DropdownMenuItem(
                text = { Text("Show dismissed") },
                onClick = { plans.showDismissed = !plans.showDismissed; expanded = false },
            )
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
