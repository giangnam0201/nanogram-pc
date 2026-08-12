package app.nanogram.pc.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.nanogram.pc.model.UserProfile
import app.nanogram.pc.theme.*

@Composable
fun ProfileScreen(profile: UserProfile) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(20.dp))

        // Avatar
        Box(
            modifier = Modifier.size(80.dp).clip(CircleShape).background(Purple500),
            contentAlignment = Alignment.Center
        ) {
            Text("@", color = TextLight, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        }

        Spacer(Modifier.height(12.dp))
        Text(profile.username.ifEmpty { "Username" }, color = Purple500,
            fontWeight = FontWeight.Bold, fontSize = 20.sp)
        Text("@${profile.displayName.ifEmpty { "display_name" }}", color = TextDim, fontSize = 13.sp)
        if (profile.bio.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text(profile.bio, color = TextLight, fontSize = 13.sp)
        }

        Spacer(Modifier.height(16.dp))

        // Stats
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatItem("${profile.followers}", "Followers")
            StatItem("${profile.following}", "Following")
            StatItem("${profile.gamesCreated}", "Games")
        }

        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = DarkBorder)
        Spacer(Modifier.height(16.dp))

        // Settings-like buttons
        ProfileButton("Edit Profile")
        ProfileButton("My Games (${profile.createdGames.size})")
        ProfileButton("Notification Settings")
        ProfileButton("Privacy & Security")
        ProfileButton("Sign Out", isSignOut = true)
    }
}

@Composable
private fun StatItem(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = Purple500, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(label, color = TextDim, fontSize = 11.sp)
    }
}

@Composable
private fun ProfileButton(text: String, isSignOut: Boolean = false) {
    val color = if (isSignOut) Red else Purple500
    OutlinedButton(
        onClick = { },
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).height(44.dp),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color),
        border = ButtonDefaults.outlinedButtonBorder.copy(
            brush = androidx.compose.ui.graphics.SolidColor(color))
    ) {
        Text(text, color = color)
    }
}
