package com.animealert;

import com.google.gson.JsonObject;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Native OkHttp client for the AniList GraphQL API.
 *
 * The web UI is loaded from file:///android_asset/index.html, where a
 * direct fetch() to https://graphql.anilist.co is blocked by the WebView.
 * The page therefore routes every AniList call (Discover, search, AniList
 * username link) through this class via the Android.anilistFetch bridge.
 */
public final class AniListClient {
    private static final String API_URL = "https://graphql.anilist.co";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build();

    private AniListClient() {}

    /**
     * Runs a GraphQL query against AniList on a background thread.
     *
     * @param gqlQuery  the GraphQL query string
     * @param variables GraphQL variables, may be null
     * @return the raw JSON response body, including any "errors" array
     * @throws IOException on network or HTTP failure
     */
    public static String query(String gqlQuery, JsonObject variables) throws IOException {
        JsonObject body = new JsonObject();
        body.addProperty("query", gqlQuery);
        if (variables != null) {
            body.add("variables", variables);
        }

        Request request = new Request.Builder()
                .url(API_URL)
                .post(RequestBody.create(body.toString(), JSON))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .build();

        try (Response response = CLIENT.newCall(request).execute()) {
            if (response.body() == null) {
                throw new IOException("Empty response from AniList");
            }
            return response.body().string();
        }
    }
}
