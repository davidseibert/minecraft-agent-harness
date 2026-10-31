package dev.agentharness.monitor;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Reads whole lines appended to a file. A line still being written waits for the next poll. */
final class TelemetryTail {
    private final Path file;
    private long offset;

    TelemetryTail(Path file, boolean fromEnd) throws IOException {
        this.file = file;
        this.offset = fromEnd && Files.exists(file) ? Files.size(file) : 0;
    }

    List<String> poll() throws IOException {
        if (!Files.exists(file)) return List.of();
        try (RandomAccessFile input = new RandomAccessFile(file.toFile(), "r")) {
            long size = input.length();
            if (size < offset) offset = 0;
            if (size == offset) return List.of();
            byte[] bytes = new byte[Math.toIntExact(size - offset)];
            input.seek(offset);
            input.readFully(bytes);

            List<String> lines = new ArrayList<>();
            int start = 0;
            for (int i = 0; i < bytes.length; i++) {
                if (bytes[i] != '\n') continue;
                lines.add(new String(bytes, start, i - start, StandardCharsets.UTF_8));
                start = i + 1;
            }
            offset += start;
            return lines;
        }
    }
}
