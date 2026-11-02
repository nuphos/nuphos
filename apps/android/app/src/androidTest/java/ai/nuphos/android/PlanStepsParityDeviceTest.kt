package ai.nuphos.android

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Surface
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.model.Plan
import ai.nuphos.android.ui.plans.PlanSteps
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlanStepsParityDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private fun step(title: String, status: String, command: String) = Plan.Step(title, jobs = listOf(Plan.Job("Job $title", commands = listOf(Plan.Command(command, status = status, stderr = if (status == "failed") "Synthetic command failure" else null)))))
    private fun render(dark: Boolean = false, steps: List<Plan.Step>) {
        compose.runOnIdle { compose.activity.setContent { NuphosTheme(darkTheme = dark) { Surface { Column { PlanSteps(steps) } } } } }
    }
    @Test fun completedCommandsStartFoldedAndCanToggle() {
        render(steps = listOf(step("Completed work", "done", "synthetic completed command")))
        compose.onNodeWithText("synthetic completed command").assertDoesNotExist()
        compose.onNodeWithText("Completed work").performClick()
        compose.onNodeWithText("synthetic completed command").assertIsDisplayed()
        compose.onNodeWithText("Completed work").performClick()
        compose.onNodeWithText("synthetic completed command").assertDoesNotExist()
    }
    @Test fun failedStepStartsOpenWithErrorInDarkTheme() {
        render(true, listOf(step("Failed work", "failed", "synthetic failed command")))
        compose.onNodeWithText("synthetic failed command").assertIsDisplayed()
        compose.onNodeWithText("Synthetic command failure").assertIsDisplayed()
        compose.onNodeWithText("Failed work").performClick()
        compose.onNodeWithText("Synthetic command failure").assertDoesNotExist()
    }
    @Test fun onlyLastRunningStepAutoExpands() {
        render(steps = listOf(step("Earlier running", "running", "earlier command"), step("Current running", "running", "current command")))
        compose.onNodeWithText("earlier command").assertDoesNotExist()
        compose.onNodeWithText("current command").assertIsDisplayed()
        compose.onNodeWithText("Earlier running").performClick()
        compose.onNodeWithText("earlier command").assertIsDisplayed()
    }
    @Test fun descriptionWithoutJobsRemainsVisible() {
        render(steps = listOf(Plan.Step("Drafting", description = "Synthetic description awaiting jobs")))
        compose.onNodeWithText("Synthetic description awaiting jobs").assertIsDisplayed()
    }
}
