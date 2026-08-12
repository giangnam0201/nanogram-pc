package app.nanogram.pc.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.nanogram.pc.model.GameItem
import app.nanogram.pc.theme.*

@Composable
fun DiscoverScreen(
    games: List<GameItem>,
    onPlay: (GameItem) -> Unit
) {
    var searchQuery by remember { mutableStateOf("") }

    Column(modifier = Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text("Search games...", color = TextDim) },
            leadingIcon = { Icon(Icons.Default.Search, null, tint = Purple500) },
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Purple500,
                unfocusedBorderColor = DarkBorder
            )
        )

        // Category chips
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            listOf("All", "Blast", "Puzzle", "Racing", "AI Gen", "Remix").forEach { cat ->
                FilterChip(
                    selected = false,
                    onClick = { },
                    label = { Text(cat, fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        containerColor = DarkBorder,
                        labelColor = TextLight
                    )
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(games) { game ->
                Card(
                    onClick = { onPlay(game) },
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = DarkSurface)
                ) {
                    Column {
                        Box(
                            modifier = Modifier.fillMaxWidth().height(140.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Surface(color = Color(0xFF2A2A4A)) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text("[Game]", color = Purple500, fontSize = 16.sp)
                                }
                            }
                        }
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(game.title, color = Purple500, fontWeight = FontWeight.Bold,
                                fontSize = 13.sp, maxLines = 1)
                            Text("@${game.authorName}", color = TextDim, fontSize = 11.sp)
                            Text("${game.plays} plays", color = TextDim, fontSize = 10.sp)
                        }
                    }
                }
            }
        }
    }
}
