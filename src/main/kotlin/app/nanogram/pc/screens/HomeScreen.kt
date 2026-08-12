package app.nanogram.pc.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.nanogram.pc.components.GameCard
import app.nanogram.pc.model.GameItem

@Composable
fun HomeScreen(
    feed: List<GameItem>,
    onPlay: (GameItem) -> Unit,
    onRemix: (GameItem) -> Unit,
    onLike: (GameItem) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp)
    ) {
        items(feed) { game ->
            GameCard(
                game = game,
                onPlay = onPlay,
                onRemix = onRemix,
                onLike = onLike
            )
        }
    }
}
