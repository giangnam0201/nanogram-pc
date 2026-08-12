package app.nanogram.pc.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.nanogram.pc.theme.*

@Composable
fun CreateScreen(credits: Int) {
    var prompt by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf("Blast") }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Create New Game", color = Purple500, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        Spacer(Modifier.height(4.dp))
        Text("Credits: $credits", color = TextDim, fontSize = 14.sp)
        Spacer(Modifier.height(20.dp))

        OutlinedTextField(
            value = prompt,
            onValueChange = { prompt = it },
            placeholder = { Text("Describe your game idea...\nEx: space shooter with cats", color = TextDim) },
            modifier = Modifier.fillMaxWidth().height(120.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Purple500,
                unfocusedBorderColor = DarkBorder
            )
        )

        Spacer(Modifier.height(16.dp))
        Text("Game Type:", color = TextLight, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(8.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Blast", "Puzzle", "Racing", "Platform").forEach { type ->
                FilterChip(
                    selected = selectedType == type,
                    onClick = { selectedType = type },
                    label = { Text(type, fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Purple500,
                        containerColor = DarkBorder
                    )
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = { },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(24.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Purple500)
        ) {
            Text("Generate Game (1 credit)", fontSize = 15.sp)
        }
    }
}
