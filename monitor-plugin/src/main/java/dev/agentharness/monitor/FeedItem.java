package dev.agentharness.monitor;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** One line for the in-game feed, parsed from telemetry.jsonl or built from a server event. */
record FeedItem(Category category, String agent, String recipient, String text, String detail, Streak streak) {
    enum Category {
        DMS,
        FAILURES,
        DEATHS,
        TOOLS;

        String id() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    enum Streak {
        NONE,
        BUMP,
        RESET
    }

    private static final Pattern TEXT_ARG = Pattern.compile("\"text\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)");
    private static final Pattern TO_ARG = Pattern.compile("\"to\"\\s*:\\s*\"([^\"]*)\"");

    static FeedItem death(String agent, String where, String cause) {
        return new FeedItem(Category.DEATHS, agent, null, where, cause, Streak.NONE);
    }

    static Optional<FeedItem> parse(String line) {
        JsonObject event = object(line);
        if (event == null) return Optional.empty();
        String agent = string(event, "agent");
        if (agent == null) return Optional.empty();
        String kind = string(event, "event");
        if ("tool".equals(kind)) return Optional.of(tool(agent, event));
        if ("stopping".equals(kind)) {
            String reason = string(event, "reason");
            String message = string(event, "message");
            return Optional.of(new FeedItem(
                    Category.FAILURES, agent, null, "stopped: " + reason, message, Streak.NONE));
        }
        if (kind != null && kind.endsWith("_error")) {
            return Optional.of(new FeedItem(
                    Category.FAILURES, agent, null, kind, string(event, "message"), Streak.NONE));
        }
        return Optional.empty();
    }

    private static FeedItem tool(String agent, JsonObject event) {
        String tool = string(event, "tool");
        String args = string(event, "args");
        String result = string(event, "result");
        boolean success = event.has("success") && event.get("success").getAsBoolean();
        String code = string(event, "failureCode");

        if (success && "send_dm".equals(tool)) {
            return new FeedItem(Category.DMS, agent, recipient(args, result), dmText(args), null, Streak.RESET);
        }
        if (success) return new FeedItem(Category.TOOLS, agent, null, tool + " " + args, result, Streak.RESET);
        // A cancellation means the agent was interrupted (usually by a DM), not that the action failed.
        if ("cancellation".equals(code)) {
            return new FeedItem(Category.TOOLS, agent, null, tool + " interrupted", result, Streak.NONE);
        }
        return new FeedItem(Category.FAILURES, agent, null, tool + " " + code + ": " + result, args, Streak.BUMP);
    }

    private static String recipient(String args, String result) {
        JsonObject sent = object(result);
        String recipient = sent == null ? null : string(sent, "recipient");
        if (recipient != null) return recipient;
        Matcher to = TO_ARG.matcher(args == null ? "" : args);
        return to.find() ? to.group(1) : "?";
    }

    /** Telemetry clips args at 500 characters, which can leave them as invalid JSON. */
    private static String dmText(String args) {
        if (args == null) return "";
        JsonObject parsed = object(args);
        if (parsed != null) {
            String text = string(parsed, "text");
            return text == null ? args : text;
        }
        Matcher text = TEXT_ARG.matcher(args);
        if (!text.find()) return args;
        String clipped = text.group(1);
        if (clipped.endsWith("...")) clipped = clipped.substring(0, clipped.length() - 3);
        return unescape(clipped) + "…";
    }

    private static String unescape(String value) {
        for (int trim = 0; trim < 6 && trim <= value.length(); trim++) {
            try {
                String candidate = value.substring(0, value.length() - trim);
                return JsonParser.parseString('"' + candidate + '"').getAsString();
            } catch (JsonParseException | IllegalStateException ignored) {
                // The clip may have landed inside an escape sequence; drop the partial tail.
            }
        }
        return value;
    }

    private static JsonObject object(String json) {
        if (json == null) return null;
        try {
            JsonElement element = JsonParser.parseString(json);
            return element.isJsonObject() ? element.getAsJsonObject() : null;
        } catch (JsonParseException e) {
            return null;
        }
    }

    private static String string(JsonObject object, String key) {
        JsonElement value = object.get(key);
        return value != null && value.isJsonPrimitive() ? value.getAsString() : null;
    }
}
