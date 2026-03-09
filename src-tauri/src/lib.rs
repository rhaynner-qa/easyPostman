use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct HttpHeader {
    key: String,
    value: String,
}

#[derive(Deserialize)]
struct RequestPayload {
    method: String,
    url: String,
    headers: Vec<HttpHeader>,
    body: String,
}

#[derive(Serialize)]
struct ResponsePayload {
    status: u16,
    status_text: String,
    headers: Vec<HttpHeader>,
    body: String,
}

#[tauri::command]
async fn send_request(payload: RequestPayload) -> Result<ResponsePayload, String> {
    let method =
        reqwest::Method::from_bytes(payload.method.as_bytes()).map_err(|_| {
            format!("Metodo invalido: {}", payload.method)
        })?;
    let client = reqwest::Client::new();
    let mut request = client.request(method, payload.url);

    for header in payload.headers {
        if !header.key.trim().is_empty() {
            request = request.header(header.key, header.value);
        }
    }

    if !payload.body.is_empty() {
        request = request.body(payload.body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let status_text = status
        .canonical_reason()
        .unwrap_or_default()
        .to_string();
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| HttpHeader {
            key: key.to_string(),
            value: value.to_str().unwrap_or("").to_string(),
        })
        .collect();
    let body_bytes = response
        .bytes()
        .await
        .map_err(|error| error.to_string())?;
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(ResponsePayload {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![send_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
