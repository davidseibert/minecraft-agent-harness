package dev.agentharness.monitor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.agentharness.monitor.FeedItem.Category;
import dev.agentharness.monitor.FeedItem.Streak;
import org.junit.jupiter.api.Test;

class FeedItemTest {
    private static String tool(String tool, String args, boolean success, String code, String result) {
        JsonObject event = new JsonObject();
        event.addProperty("time", "2026-10-31T03:26:14.030Z");
        event.addProperty("agent", "Cleo");
        event.addProperty("event", "tool");
        event.addProperty("tool", tool);
        event.addProperty("args", args);
        event.addProperty("timeMs", 3);
        event.addProperty("success", success);
        if (code != null) event.addProperty("failureCode", code);
        event.addProperty("result", result);
        return event.toString();
    }

    @Test
    void readsARealTelemetryLine() {
        String line = "{\"time\":\"2026-10-31T03:26:14.030Z\",\"agent\":\"Cleo\",\"event\":\"tool\",\"tool\":\"send_dm\","
                + "\"args\":\"{\\\"to\\\":\\\"Ada\\\",\\\"text\\\":\\\"Thanks, glad path links village.\\\"}\","
                + "\"timeMs\":3,\"success\":true,\"result\":\"{\\\"sent\\\":true,\\\"id\\\":36,\\\"recipient\\\":\\\"Ada\\\"}\"}";
        FeedItem item = FeedItem.parse(line).orElseThrow();
        assertEquals(Category.DMS, item.category());
        assertEquals("Cleo", item.agent());
        assertEquals("Ada", item.recipient());
        assertEquals("Thanks, glad path links village.", item.text());
    }

    @Test
    void recoversADmClippedAt500Characters() {
        String args = "{\"to\":\"Ada\",\"text\":\"she said \\\"hi\\\" and then " + "x".repeat(460) + "...";
        FeedItem item = FeedItem.parse(tool("send_dm", args, true, null, "{\"recipient\":\"Ada\"}")).orElseThrow();
        assertEquals("Ada", item.recipient());
        assertTrue(item.text().startsWith("she said \"hi\" and then xxx"), item.text());
        assertTrue(item.text().endsWith("x…"), item.text());
    }

    @Test
    void recoversADmClippedInsideAnEscape() {
        String args = "{\"to\":\"Ada\",\"text\":\"line\\u00...";
        FeedItem item = FeedItem.parse(tool("send_dm", args, true, null, "{\"recipient\":\"Ada\"}")).orElseThrow();
        assertEquals("line…", item.text());
    }

    @Test
    void usesTheResultWhenClippingHidTheRecipient() {
        String args = "{\"text\":\"" + "y".repeat(500) + "...";
        FeedItem item = FeedItem.parse(tool("send_dm", args, true, null, "{\"recipient\":\"Bram\"}")).orElseThrow();
        assertEquals("Bram", item.recipient());
    }

    @Test
    void reportsARealFailureAndCountsIt() {
        FeedItem item = FeedItem.parse(tool("go_to", "{\"x\":41}", false, "no_path", "No route")).orElseThrow();
        assertEquals(Category.FAILURES, item.category());
        assertEquals("go_to no_path: No route", item.text());
        assertEquals(Streak.BUMP, item.streak());
    }

    @Test
    void treatsACancellationAsRoutine() {
        FeedItem item = FeedItem.parse(tool("place", "{}", false, "cancellation", "Interrupted")).orElseThrow();
        assertEquals(Category.TOOLS, item.category());
        assertEquals(Streak.NONE, item.streak());
    }

    @Test
    void aSuccessClearsTheFailureStreak() {
        assertEquals(Streak.RESET, FeedItem.parse(tool("go_to", "{}", true, null, "{}")).orElseThrow().streak());
    }

    @Test
    void reportsAnAgentStopping() {
        String line = "{\"agent\":\"Ada\",\"event\":\"stopping\",\"reason\":\"unsafe_action\"}";
        FeedItem item = FeedItem.parse(line).orElseThrow();
        assertEquals(Category.FAILURES, item.category());
        assertEquals("stopped: unsafe_action", item.text());
    }

    @Test
    void ignoresEverythingElse() {
        assertFalse(FeedItem.parse("{\"agent\":\"Ada\",\"event\":\"observation\",\"health\":20}").isPresent());
        assertFalse(FeedItem.parse("{\"agent\":\"Ada\",\"event\":\"place\"}").isPresent());
        assertFalse(FeedItem.parse("not json").isPresent());
        assertFalse(FeedItem.parse("").isPresent());
        assertFalse(FeedItem.parse("{\"event\":\"tool\"}").isPresent());
    }
}
