package com.animealert;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Background check for NEW episodes of shows the user actually added
 * to their watchlist. Does nothing if the watchlist is empty — never
 * falls back to hardcoded titles like One Piece / Demon Slayer.
 */
public class AnimeCheckWorker extends Worker {
    private static final String PREFS = "anime_alert";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final String QUERY =
            "query($ids:[Int]){Page(page:1,perPage:50){media(id_in:$ids,type:ANIME){id title{romaji english} nextAiringEpisode{episode airingAt}}}}";

    public AnimeCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String watchJson = prefs.getString("watchlist_json", "[]");
        JsonArray list;
        try {
            JsonElement parsed = JsonParser.parseString(watchJson);
            if (!parsed.isJsonArray()) {
                return Result.success();
            }
            list = parsed.getAsJsonArray();
        } catch (Exception e) {
            return Result.success();
        }

        if (list.size() == 0) {
            prefs.edit()
                    .putLong("countdown_target", 0)
                    .putString("countdown_title", "")
                    .putInt("countdown_anime_id", -1)
                    .apply();
            return Result.success();
        }

        JsonArray ids = new JsonArray();
        for (JsonElement el : list) {
            if (el.isJsonObject() && el.getAsJsonObject().has("id")) {
                ids.add(el.getAsJsonObject().get("id").getAsInt());
            }
        }
        if (ids.size() == 0) {
            return Result.success();
        }

        JsonObject lastNext;
        try {
            lastNext = JsonParser.parseString(prefs.getString("last_next_ep", "{}")).getAsJsonObject();
        } catch (Exception e) {
            lastNext = new JsonObject();
        }

        OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .build();

        JsonObject variables = new JsonObject();
        variables.add("ids", ids);
        JsonObject body = new JsonObject();
        body.addProperty("query", QUERY);
        body.add("variables", variables);

        Request request = new Request.Builder()
                .url("https://graphql.anilist.co")
                .post(RequestBody.create(body.toString(), JSON))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                return Result.retry();
            }
            JsonObject root = JsonParser.parseString(response.body().string()).getAsJsonObject();
            if (!root.has("data") || root.get("data").isJsonNull()) {
                return Result.retry();
            }
            JsonArray media = root.getAsJsonObject("data")
                    .getAsJsonObject("Page")
                    .getAsJsonArray("media");

            SharedPreferences.Editor editor = prefs.edit();
            long earliestTime = Long.MAX_VALUE;
            String earliestTitle = "";
            int earliestId = -1;
            long now = System.currentTimeMillis();
            int newCount = prefs.getInt("new_episodes_count", 0);
            String latestEpisode = prefs.getString("latest_episode", "");

            for (JsonElement el : media) {
                JsonObject m = el.getAsJsonObject();
                int id = m.get("id").getAsInt();
                String title = titleOf(m);
                int nextEp = 0;
                Long airingAtMs = null;
                if (m.has("nextAiringEpisode") && !m.get("nextAiringEpisode").isJsonNull()) {
                    JsonObject nae = m.getAsJsonObject("nextAiringEpisode");
                    nextEp = nae.get("episode").getAsInt();
                    airingAtMs = nae.get("airingAt").getAsLong() * 1000L;
                }
                String idKey = String.valueOf(id);
                if (!lastNext.has(idKey)) {
                    // First time we see this watchlist title — don't dump old episodes
                    lastNext.addProperty(idKey, nextEp);
                } else {
                    int prev = lastNext.get(idKey).getAsInt();
                    if (nextEp > prev && prev > 0) {
                        for (int e = prev; e < nextEp; e++) {
                            String msg = title + " — Episode " + e + " is out";
                            NotificationHelper.showNotification(getApplicationContext(), msg);
                            newCount++;
                            latestEpisode = msg;
                        }
                    }
                    if (nextEp > 0) {
                        lastNext.addProperty(idKey, nextEp);
                    }
                }
                if (airingAtMs != null && airingAtMs > now && airingAtMs < earliestTime) {
                    earliestTime = airingAtMs;
                    earliestTitle = title;
                    earliestId = id;
                }
            }

            Set<String> liveIds = new HashSet<>();
            for (JsonElement el : ids) {
                liveIds.add(String.valueOf(el.getAsInt()));
            }
            JsonObject pruned = new JsonObject();
            for (String key : lastNext.keySet()) {
                if (liveIds.contains(key)) {
                    pruned.add(key, lastNext.get(key));
                }
            }

            editor.putString("last_next_ep", pruned.toString());
            editor.putInt("new_episodes_count", newCount);
            editor.putString("latest_episode", latestEpisode);
            if (earliestId > 0) {
                editor.putLong("countdown_target", earliestTime);
                editor.putString("countdown_title", earliestTitle);
                editor.putInt("countdown_anime_id", earliestId);
            } else {
                editor.putLong("countdown_target", 0);
                editor.putString("countdown_title", "");
                editor.putInt("countdown_anime_id", -1);
            }
            editor.apply();
            return Result.success();
        } catch (IOException e) {
            return Result.retry();
        }
    }

    private static String titleOf(JsonObject m) {
        if (!m.has("title") || !m.get("title").isJsonObject()) {
            return "Anime";
        }
        JsonObject t = m.getAsJsonObject("title");
        if (t.has("english") && !t.get("english").isJsonNull()) {
            String english = t.get("english").getAsString();
            if (!english.isEmpty()) {
                return english;
            }
        }
        if (t.has("romaji") && !t.get("romaji").isJsonNull()) {
            return t.get("romaji").getAsString();
        }
        return "Anime";
    }
}
