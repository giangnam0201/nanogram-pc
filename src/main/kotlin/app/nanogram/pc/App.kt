package app.nanogram.pc

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.nanogram.pc.components.NavBar
import app.nanogram.pc.model.*
import app.nanogram.pc.screens.*
import app.nanogram.pc.theme.*
import kotlinx.coroutines.launch
import java.awt.Desktop
import java.net.URI

@Composable
fun App() {
    val scope = rememberCoroutineScope()
    var currentScreen by remember { mutableStateOf(Screen.Home) }
    var showMenu by remember { mutableStateOf(false) }
    var feed by remember { mutableStateOf(sampleFeed) }
    var inboxMessages by remember { mutableStateOf(sampleInbox) }
    var profile by remember { mutableStateOf(sampleProfile) }

    NanogramTheme {
        Scaffold(
            topBar = {
                Surface(color = DarkSurface) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Nano", color = Purple500, fontWeight = FontWeight.Bold, fontSize = 18.sp)

                        Box {
                            IconButton(onClick = { showMenu = true }) {
                                Icon(Icons.Default.MoreVert, "Menu", tint = TextDim)
                            }
                            DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                                DropdownMenuItem(text = { Text("Settings") }, onClick = {
                                    currentScreen = Screen.Profile; showMenu = false
                                })
                                DropdownMenuItem(text = { Text("Exit") }, onClick = {
                                    kotlin.system.exitProcess(0)
                                })
                            }
                        }
                    }
                }
            },
            bottomBar = {
                NavBar(
                    currentScreen = currentScreen,
                    onScreenSelected = { currentScreen = it }
                )
            },
            containerColor = DarkBg
        ) { padding ->
            Box(modifier = Modifier.padding(padding)) {
                when (currentScreen) {
                    Screen.Home -> HomeScreen(
                        feed = feed,
                        onPlay = { game -> openGame(game) },
                        onRemix = { game -> openGame(game) },
                        onLike = { game -> /* TODO api call */ }
                    )
                    Screen.Discover -> DiscoverScreen(
                        games = feed,
                        onPlay = { game -> openGame(game) }
                    )
                    Screen.Create -> CreateScreen(credits = 5)
                    Screen.Inbox -> InboxScreen(
                        messages = inboxMessages,
                        onSend = { text ->
                            inboxMessages = inboxMessages + ChatMessage(
                                id = "msg_${System.currentTimeMillis()}",
                                senderId = "me", senderName = "You",
                                text = text, timestamp = System.currentTimeMillis(), isMe = true
                            )
                        }
                    )
                    Screen.Profile -> ProfileScreen(profile = profile)
                }
            }
        }
    }
}

private fun openGame(game: GameItem) {
    try {
        Desktop.getDesktop().browse(URI("https://games.nanogram.app/games/${game.id}"))
    } catch (_: Exception) {}
}

val sampleFeed = listOf(
    GameItem("1","Space Blaster","","@astrodev","",1240,340,28,60,false,"blast"),
    GameItem("2","Puzzle Quest","","@puzzlemaster","",892,210,15,45,false,"puzzle"),
    GameItem("3","AI Dreamscape","","@aigen.io","",3400,890,120,90,true,"gamegen"),
    GameItem("4","Neon Racer X","","@speedstar","",567,145,8,30,false,"racing"),
    GameItem("5","Block Breaker Deluxe","","@retrogamer","",2340,670,56,60,true,"blast"),
    GameItem("6","Candy Crunch","","@sweetdev","",4500,1200,200,120,false,"puzzle"),
    GameItem("7","Pixel Jump","","@indiemaker","",780,200,15,50,false,"platform"),
)

val sampleInbox = listOf(
    ChatMessage("1","u1","@astrodev","Your Space Blaster is amazing! Mind if I remix?",System.currentTimeMillis()-300000,false),
    ChatMessage("2","u2","@puzzlemaster","New challenge: beat my puzzle score!",System.currentTimeMillis()-600000,false),
    ChatMessage("3","me","You","Sure, let me try!",System.currentTimeMillis()-590000,true),
)

val sampleProfile = UserProfile(
    id = "me", username = "nanouser", displayName = "Nano Gamer",
    bio = "Game creator & player | Building the future of gaming",
    followers = 128, following = 64, gamesCreated = 3,
    createdGames = sampleFeed.take(3)
)
