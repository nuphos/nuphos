package ai.nuphos.android

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.rules.TestRule
import org.junit.runners.model.Statement

/**
 * Skips each test outside the fixture's own package. As the outermost rule it runs before the
 * other rules and before @Before and @After, so none of them touch the app's state. Each test is
 * still reported as skipped, which the connected test runner counts; a skipped @BeforeClass is not.
 */
fun isolatedPackage(accepts: (String) -> Boolean) = TestRule { base, _ ->
    object : Statement() {
        override fun evaluate() {
            val packageName = InstrumentationRegistry.getInstrumentation().targetContext.packageName

            assumeTrue("Runs only in its isolated fixture package", accepts(packageName))
            base.evaluate()
        }
    }
}
