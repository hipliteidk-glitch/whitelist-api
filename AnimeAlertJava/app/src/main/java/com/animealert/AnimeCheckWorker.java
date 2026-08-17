package com.animealert;

import android.content.Context;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;

public class AnimeCheckWorker extends Worker {
    public AnimeCheckWorker(Context context, WorkerParameters params) {
        super(context, params);
    }

    @Override
    public Result doWork() {
        // List of anime to track
        String[] shows = {"One Piece", "Demon Slayer", "Attack on Titan"};
        OkHttpClient client = new OkHttpClient();

        for (String show : shows) {
            try {
                String url = "https://api.jikan.moe/v4/anime?q=" + show.replace(" ", "%20") + "&limit=1";
                Request request = new Request.Builder().url(url).build();
                Response response = client.newCall(request).execute();
                if (response.isSuccessful()) {
                    String json = response.body().string();
                    JsonObject root = JsonParser.parseString(json).getAsJsonObject();
                    JsonArray data = root.getAsJsonArray("data");
                    if (data.size() > 0) {
                        JsonObject anime = data.get(0).getAsJsonObject();
                        int malId = anime.get("mal_id").getAsInt();
                        // Check episodes
                        String epUrl = "https://api.jikan.moe/v4/anime/" + malId + "/episodes";
                        Request epRequest = new Request.Builder().url(epUrl).build();
                        Response epResponse = client.newCall(epRequest).execute();
                        if (epResponse.isSuccessful()) {
                            String epJson = epResponse.body().string();
                            JsonObject epRoot = JsonParser.parseString(epJson).getAsJsonObject();
                            JsonArray epData = epRoot.getAsJsonArray("data");
                            if (epData.size() > 0) {
                                JsonObject latest = epData.get(epData.size() - 1).getAsJsonObject();
                                int epId = latest.get("episode_id").getAsInt();
                                String epTitle = latest.get("title").getAsString();
                                // Check if we've already notified (using SharedPreferences)
                                // Simplified: send notification
                                NotificationHelper.showNotification(getApplicationContext(),
                                        show + " - Episode " + epId + ": " + epTitle);
                            }
                        }
                    }
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
        return Result.success();
    }
}
