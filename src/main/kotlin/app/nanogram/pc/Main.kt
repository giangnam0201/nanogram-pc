package app.nanogram.pc

import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "Nanogram PC",
        state = rememberWindowState(
            size = DpSize(420.dp, 800.dp),
            position = WindowPosition(Alignment.Center)
        )
    ) {
        App()
    }
}
