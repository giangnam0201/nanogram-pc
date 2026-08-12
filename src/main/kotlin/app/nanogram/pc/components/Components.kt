package app.nanogram.pc.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.nanogram.pc.model.GameItem
import app.nanogram.pc.model.Screen
import app.nanogram.pc.theme.*

@Composable
fun NavBar(
    currentScreen: Screen,
    onScreenSelected: (Screen) -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = DarkSurface,
        tonalElevation = 4.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            NavItem("Home", Icons.Default.Home, Screen.Home, currentScreen, onScreenSelected)
            NavItem("Discover", Icons.Default.Search, Screen.Discover, currentScreen, onScreenSelected)
            NavItem("Create", Icons.Default.AddCircle, Screen.Create, currentScreen, onScreenSelected)
            NavItem("Inbox", Icons.Default.Email, Screen.Inbox, currentScreen, onScreenSelected)
            NavItem("Profile", Icons.Default.Person, Screen.Profile, currentScreen, onScreenSelected)
        }
    }
}

@Composable
private fun NavItem(
    label: String,
    icon: ImageVector,
    screen: Screen,
    current: Screen,
    onClick: (Screen) -> Unit
) {
    val isActive = current == screen
    val color = if (isActive) Purple500 else TextDim

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clickable { onClick(screen) }
            .padding(vertical = 4.dp, horizontal = 12.dp)
    ) {
        Icon(icon, contentDescription = label, tint = color, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(2.dp))
        Text(label, fontSize = 10.sp, color = color)
    }
}

@Composable
fun GameCard(
    game: GameItem,
    onPlay: (GameItem) -> Unit,
    onRemix: (GameItem) -> Unit,
    onLike: (GameItem) -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = DarkSurface)
    ) {
        Column {
            // Thumbnail placeholder
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .background(Color(0xFF2A2A4A)),
                contentAlignment = Alignment.Center
            ) {
                Text("[ Game Preview ]", color = Purple500, fontSize = 18.sp)
                if (game.isRemix) {
                    Text("(Remixed)", color = TextDim, fontSize = 11.sp,
                        modifier = Modifier.align(Alignment.TopEnd).padding(8.dp))
                }
            }

            Column(modifier = Modifier.padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(game.title, color = Purple500, fontWeight = FontWeight.Bold,
                        fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.weight(1f))
                    Surface(color = Purple500.copy(alpha = 0.2f), shape = RoundedCornerShape(8.dp)) {
                        Text(game.gameType, color = Purple500, fontSize = 10.sp,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                    }
                }

                Spacer(Modifier.height(2.dp))
                Text("@${game.authorName}", color = TextDim, fontSize = 12.sp)

                Spacer(Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.PlayArrow, null, tint = TextDim, modifier = Modifier.size(14.dp))
                        Text("${game.plays}", color = TextDim, fontSize = 11.sp)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.FavoriteBorder, null, tint = TextDim, modifier = Modifier.size(14.dp))
                        Text("${game.likes}", color = TextDim, fontSize = 11.sp)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.ContentCopy, null, tint = TextDim, modifier = Modifier.size(14.dp))
                        Text("${game.remixes}", color = TextDim, fontSize = 11.sp)
                    }
                }

                Spacer(Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    Button(
                        onClick = { onPlay(game) },
                        colors = ButtonDefaults.buttonColors(containerColor = Purple500),
                        shape = RoundedCornerShape(20.dp),
                        modifier = Modifier.weight(1f)
                    ) { Icon(Icons.Default.PlayArrow, null, Modifier.size(16.dp)); Text(" Play") }

                    Spacer(Modifier.width(8.dp))

                    OutlinedButton(
                        onClick = { onRemix(game) },
                        shape = RoundedCornerShape(20.dp),
                        modifier = Modifier.weight(1f),
                        border = ButtonDefaults.outlinedButtonBorder.copy(
                            brush = androidx.compose.ui.graphics.SolidColor(Purple500))
                    ) { Icon(Icons.Default.ContentCopy, null, Modifier.size(16.dp), tint = Purple500); Text("Remix", color = Purple500) }

                    Spacer(Modifier.width(8.dp))

                    IconButton(onClick = { onLike(game) }) {
                        Icon(Icons.Default.FavoriteBorder, "Like", tint = Purple500)
                    }
                }
            }
        }
    }
}

@Composable
fun ChatBubble(
    message: app.nanogram.pc.model.ChatMessage,
    modifier: Modifier = Modifier
) {
    val bgColor = if (message.isMe) Purple500 else DarkBorder
    val align = if (message.isMe) Alignment.End else Alignment.Start

    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalAlignment = align
    ) {
        if (!message.isMe) {
            Text(message.senderName, color = Purple500, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
        Surface(
            color = bgColor,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.widthIn(max = 280.dp)
        ) {
            Text(message.text, color = if (message.isMe) Color.White else TextLight,
                fontSize = 14.sp, modifier = Modifier.padding(10.dp))
        }
    }
}
