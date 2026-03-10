import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

const METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const createId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createKeyValueRow = (overrides = {}) => ({
  key: "",
  value: "",
  description: "",
  enabled: true,
  ...overrides,
});

const isRowEmpty = (row) =>
  !row?.key && !row?.value && !row?.description;

const normalizeRows = (rows) => {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const normalized = list.map((row) => ({
    ...createKeyValueRow(),
    ...row,
    enabled: row?.enabled !== false,
    description: row?.description ?? "",
  }));
  const trimmed = normalized.filter(
    (row, index) => !isRowEmpty(row) || index === list.length - 1,
  );
  if (!trimmed.length || !isRowEmpty(trimmed[trimmed.length - 1])) {
    return [...trimmed, createKeyValueRow()];
  }
  return trimmed;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const buildReportHtml = (runs) => {
  const total = runs.length;
  const passes = runs.reduce(
    (count, run) => count + run.tests.filter((test) => test.status === "pass").length,
    0,
  );
  const failures = runs.reduce(
    (count, run) => count + run.tests.filter((test) => test.status === "fail").length,
    0,
  );
  const duration = runs.reduce((sum, run) => sum + (run.duration ?? 0), 0);

  const itemsHtml = runs
    .map((run) => {
      const testsHtml = run.tests.length
        ? run.tests
            .map(
              (test) => `
              <div class="test-row ${test.status}">
                <span>${escapeHtml(test.status)}</span>
                <span>${escapeHtml(test.name)}</span>
                ${
                  test.error
                    ? `<span class="test-error">${escapeHtml(test.error)}</span>`
                    : ""
                }
              </div>
            `,
            )
            .join("")
        : `<div class="test-row muted">Sem testes</div>`;

      return `
        <section class="run-card">
          <div class="run-header">
            <div>
              <div class="run-name">${escapeHtml(run.name)}</div>
              <div class="run-url">${escapeHtml(run.method)} ${escapeHtml(
        run.url,
      )}</div>
            </div>
            <div class="run-meta">
              <span>Status ${escapeHtml(run.status)}</span>
              <span>${escapeHtml(run.duration)} ms</span>
              <span>${escapeHtml(run.size)} bytes</span>
            </div>
          </div>
          <div class="tests-block">
            <div class="tests-title">Tests</div>
            ${testsHtml}
          </div>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>easyPostman Report</title>
    <style>
      :root { font-family: "IBM Plex Sans", "Segoe UI", sans-serif; color: #1a1f2b; }
      body { margin: 0; background: #f3f5f9; }
      .page { max-width: 960px; margin: 0 auto; padding: 32px 20px 40px; }
      .header { display: flex; justify-content: space-between; align-items: center; }
      .title { font-size: 22px; font-weight: 700; }
      .subtitle { color: #667085; font-size: 12px; }
      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
      .summary-card { background: #fff; border-radius: 12px; padding: 14px; border: 1px solid #e2e8f0; }
      .summary-card span { display: block; font-size: 12px; color: #667085; }
      .summary-card strong { font-size: 18px; }
      .run-card { background: #fff; border-radius: 16px; padding: 16px; border: 1px solid #e2e8f0; margin-bottom: 16px; }
      .run-header { display: flex; justify-content: space-between; gap: 12px; }
      .run-name { font-weight: 600; font-size: 16px; }
      .run-url { font-size: 12px; color: #667085; margin-top: 4px; }
      .run-meta { display: flex; gap: 12px; font-size: 12px; color: #475467; }
      .tests-block { margin-top: 14px; }
      .tests-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #667085; margin-bottom: 8px; }
      .test-row { display: grid; grid-template-columns: 70px 1fr; gap: 8px; font-size: 12px; margin-bottom: 6px; }
      .test-row.pass span:first-child { color: #15803d; font-weight: 600; }
      .test-row.fail span:first-child { color: #b42318; font-weight: 600; }
      .test-row.muted { color: #98a2b3; }
      .test-error { grid-column: span 2; color: #b42318; }
      @media (max-width: 720px) { .summary { grid-template-columns: repeat(2, 1fr); } }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          <div class="title">easyPostman Report</div>
          <div class="subtitle">Gerado em ${new Date().toISOString()}</div>
        </div>
      </div>
      <div class="summary">
        <div class="summary-card"><span>Requisicoes</span><strong>${total}</strong></div>
        <div class="summary-card"><span>Passes</span><strong>${passes}</strong></div>
        <div class="summary-card"><span>Failures</span><strong>${failures}</strong></div>
        <div class="summary-card"><span>Duracao</span><strong>${duration} ms</strong></div>
      </div>
      ${itemsHtml}
    </div>
  </body>
</html>`;
};

const resolveVariables = (text, variables) => {
  if (!text) return "";
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const value = variables?.[key.trim()];
    return value ?? "";
  });
};

const parseUrlFromPostman = (url) => {
  if (!url) return "";
  if (typeof url === "string") return url;
  if (url.raw) return url.raw;
  const host = Array.isArray(url.host) ? url.host.join(".") : "";
  const path = Array.isArray(url.path) ? url.path.join("/") : "";
  const protocol = url.protocol ? `${url.protocol}://` : "";
  const base = `${protocol}${host}${path ? `/${path}` : ""}`;
  if (Array.isArray(url.query) && url.query.length) {
    const query = url.query
      .map((item) => `${item.key ?? ""}=${item.value ?? ""}`)
      .join("&");
    return `${base}?${query}`;
  }
  return base;
};

const extractQueryParams = (rawUrl, urlObject) => {
  const params = [];
  if (Array.isArray(urlObject?.query)) {
    urlObject.query.forEach((item) => {
      params.push({
        key: item.key ?? "",
        value: item.value ?? "",
        description:
          typeof item.description === "string" ? item.description : "",
        enabled: !item.disabled,
      });
    });
  }
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      parsed.searchParams.forEach((value, key) => {
        params.push(createKeyValueRow({ key, value }));
      });
    } catch {
      return params;
    }
  }
  return normalizeRows(params);
};

const normalizeHeaders = (headers) => {
  if (!Array.isArray(headers) || !headers.length) {
    return normalizeRows([]);
  }
  return normalizeRows(
    headers.map((header) => ({
      key: header.key ?? "",
      value: header.value ?? "",
      description:
        typeof header.description === "string" ? header.description : "",
      enabled: !header.disabled,
    })),
  );
};

const normalizeRequestFromPostman = (request) => {
  const url = parseUrlFromPostman(request?.url);
  const params = extractQueryParams(url, request?.url);
  const body =
    request?.body?.mode === "raw" ? request.body.raw ?? "" : "";
  return {
    method: (request?.method ?? "GET").toUpperCase(),
    url,
    params: normalizeRows(params),
    headers: normalizeHeaders(request?.header),
    body,
  };
};

const extractScripts = (events) => {
  const result = { pre: "", tests: "" };
  if (!Array.isArray(events)) return result;
  events.forEach((event) => {
    const exec = Array.isArray(event?.script?.exec)
      ? event.script.exec.join("\n")
      : "";
    if (event.listen === "prerequest") {
      result.pre = exec;
    }
    if (event.listen === "test") {
      result.tests = exec;
    }
  });
  return result;
};

const mapCollectionItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (item?.request) {
      return {
        id: createId(),
        type: "request",
        name: item.name ?? "Requisicao",
        request: normalizeRequestFromPostman(item.request),
        scripts: extractScripts(item.event),
      };
    }
    if (Array.isArray(item?.item)) {
      return {
        id: createId(),
        type: "folder",
        name: item.name ?? "Pasta",
        children: mapCollectionItems(item.item),
      };
    }
    return {
      id: createId(),
      type: "request",
      name: item?.name ?? "Requisicao",
      request: normalizeRequestFromPostman(item?.request),
      scripts: extractScripts(item?.event),
    };
  });
};

const parseCollection = (data) => ({
  id: createId(),
  name: data?.info?.name ?? "Collection sem nome",
  items: mapCollectionItems(data?.item),
});

const parseEnvironment = (data) => {
  const values = {};
  if (Array.isArray(data?.values)) {
    data.values.forEach((item) => {
      if (item?.key) {
        values[item.key] = item?.value ?? "";
      }
    });
  }
  return {
    id: createId(),
    name: data?.name ?? "Environment sem nome",
    values,
  };
};

const buildUrlWithParams = (url, params) => {
  const filtered = params.filter(
    (param) => param.enabled && param.key,
  );
  if (!filtered.length) return url;
  try {
    const parsed = new URL(url);
    filtered.forEach((param) => {
      parsed.searchParams.set(param.key, param.value);
    });
    return parsed.toString();
  } catch {
    const query = filtered
      .map(
        (param) =>
          `${encodeURIComponent(param.key)}=${encodeURIComponent(
            param.value ?? "",
          )}`,
      )
      .join("&");
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}${query}`;
  }
};

const createPmRunner = ({ request, response, envValues }) => {
  const tests = [];
  const mutableEnv = envValues;

  const pm = {
    request,
    response,
    environment: {
      get: (key) => mutableEnv?.[key],
      set: (key, value) => {
        mutableEnv[key] = `${value ?? ""}`;
      },
      unset: (key) => {
        delete mutableEnv[key];
      },
    },
    test: (name, fn) => {
      try {
        fn();
        tests.push({ name, status: "pass" });
      } catch (error) {
        tests.push({
          name,
          status: "fail",
          error: error?.message ?? String(error),
        });
      }
    },
    expect: (value) => ({
      toBe: (expected) => {
        if (value !== expected) {
          throw new Error(`Esperado ${value} ser ${expected}`);
        }
      },
      toEqual: (expected) => {
        if (JSON.stringify(value) !== JSON.stringify(expected)) {
          throw new Error("Valores nao sao iguais");
        }
      },
      toContain: (expected) => {
        if (!String(value).includes(expected)) {
          throw new Error(`Esperado conter ${expected}`);
        }
      },
      toBeTruthy: () => {
        if (!value) {
          throw new Error("Esperado verdadeiro");
        }
      },
      toBeFalsy: () => {
        if (value) {
          throw new Error("Esperado falso");
        }
      },
    }),
  };

  return { pm, tests, mutableEnv };
};

function App() {
  const [collections, setCollections] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [activeEnvId, setActiveEnvId] = useState("");
  const [activeRequestId, setActiveRequestId] = useState("");
  const [activeTab, setActiveTab] = useState("Params");
  const [scriptTab, setScriptTab] = useState("Pre");
  const [response, setResponse] = useState(null);
  const [testResults, setTestResults] = useState([]);
  const [runs, setRuns] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [importError, setImportError] = useState("");

  const [requestDraft, setRequestDraft] = useState({
    name: "Nova requisicao",
    method: "GET",
    url: "",
    params: [createKeyValueRow()],
    headers: [createKeyValueRow()],
    body: "",
    scripts: { pre: "", tests: "" },
  });

  const activeEnvironment = useMemo(
    () => environments.find((env) => env.id === activeEnvId),
    [environments, activeEnvId],
  );

  const envValues = activeEnvironment?.values ?? {};

  const updateRequest = (patch) => {
    setRequestDraft((current) => {
      const next = { ...current, ...patch };
      if (patch.params) {
        next.params = normalizeRows(patch.params);
      }
      if (patch.headers) {
        next.headers = normalizeRows(patch.headers);
      }
      return next;
    });
  };

  const updateKeyValue = (section, index, field, value) => {
    setRequestDraft((current) => {
      const next = current[section].map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, [field]: value };
      });
      return { ...current, [section]: normalizeRows(next) };
    });
  };

  const updateRowEnabled = (section, index, enabled) => {
    setRequestDraft((current) => {
      const next = current[section].map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, enabled };
      });
      return { ...current, [section]: normalizeRows(next) };
    });
  };

  const handleImportCollection = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const parsed = parseCollection(data);
      setCollections((current) => [...current, parsed]);
      setImportError("");
    } catch (error) {
      setImportError("Falha ao importar collection.");
    }
    event.target.value = "";
  };

  const handleImportEnvironment = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const parsed = parseEnvironment(data);
      setEnvironments((current) => [...current, parsed]);
      setActiveEnvId(parsed.id);
      setImportError("");
    } catch (error) {
      setImportError("Falha ao importar environment.");
    }
    event.target.value = "";
  };

  const selectRequest = (item) => {
    setActiveRequestId(item.id);
    updateRequest({
      name: item.name,
      method: item.request.method,
      url: item.request.url,
      params: normalizeRows(item.request.params),
      headers: normalizeRows(item.request.headers),
      body: item.request.body,
      scripts: item.scripts ?? { pre: "", tests: "" },
    });
    setResponse(null);
    setTestResults([]);
  };

  const commitEnvValues = (values) => {
    if (!activeEnvId) return;
    setEnvironments((current) =>
      current.map((env) =>
        env.id === activeEnvId ? { ...env, values } : env,
      ),
    );
  };

  const recordRun = (payload) => {
    setRuns((current) => [
      ...current,
      {
        id: createId(),
        timestamp: new Date().toISOString(),
        ...payload,
      },
    ]);
  };

  const downloadReport = () => {
    if (!runs.length) return;
    const html = buildReportHtml(runs);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `easy-postman-report-${Date.now()}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runScript = (script, context) => {
    if (!script?.trim()) return { tests: [], error: "" };
    const { pm, tests, mutableEnv } = createPmRunner(context);
    try {
      // eslint-disable-next-line no-new-func
      const runner = new Function("pm", script);
      runner(pm);
    } catch (error) {
      return {
        tests,
        error: error?.message ?? "Erro ao executar script.",
        envValues: mutableEnv,
      };
    }
    return { tests, error: "", envValues: mutableEnv };
  };

  const handleSend = async () => {
    setIsSending(true);
    setResponse(null);
    setTestResults([]);

    const envSnapshot = { ...envValues };
    const preRun = runScript(requestDraft.scripts.pre, {
      request: {
        method: requestDraft.method,
        url: requestDraft.url,
      },
      response: null,
      envValues: envSnapshot,
    });
    if (preRun.envValues) {
      commitEnvValues(preRun.envValues);
    }

    const resolvedEnv = preRun.envValues ?? envSnapshot;
    const resolvedParams = requestDraft.params
      .filter((param) => param.enabled && param.key)
      .map((param) => ({
        key: resolveVariables(param.key, resolvedEnv),
        value: resolveVariables(param.value, resolvedEnv),
      }));
    const resolvedUrl = buildUrlWithParams(
      resolveVariables(requestDraft.url, resolvedEnv),
      resolvedParams,
    );
    const resolvedHeaders = requestDraft.headers
      .filter((header) => header.enabled && header.key)
      .map((header) => ({
        key: resolveVariables(header.key, resolvedEnv),
        value: resolveVariables(header.value, resolvedEnv),
      }));
    const resolvedBody = resolveVariables(requestDraft.body, resolvedEnv);

    const start = performance.now();
    try {
      const result = await invoke("send_request", {
        method: requestDraft.method,
        url: resolvedUrl,
        headers: resolvedHeaders,
        body: resolvedBody,
      });
      const duration = Math.round(performance.now() - start);
      const bodySize = result.body?.length ?? 0;
      const responsePayload = { ...result, duration, size: bodySize };
      setResponse(responsePayload);

      const testRun = runScript(requestDraft.scripts.tests, {
        request: {
          method: requestDraft.method,
          url: resolvedUrl,
          headers: resolvedHeaders,
          body: resolvedBody,
        },
        response: {
          code: result.status,
          status: result.status_text,
          headers: result.headers,
          text: () => result.body,
          json: () => JSON.parse(result.body || "{}"),
        },
        envValues: resolvedEnv,
      });
      if (testRun.envValues) {
        commitEnvValues(testRun.envValues);
      }
      const tests = testRun.tests ?? [];
      setTestResults(tests);
      recordRun({
        name: requestDraft.name,
        method: requestDraft.method,
        url: resolvedUrl,
        status: result.status,
        duration,
        size: bodySize,
        tests,
      });
    } catch (error) {
      const errorMessage = error?.message ?? "Falha ao enviar requisicao.";
      setResponse({
        status: 0,
        status_text: "Erro",
        headers: [],
        body: errorMessage,
        duration: 0,
        size: 0,
      });
      recordRun({
        name: requestDraft.name,
        method: requestDraft.method,
        url: resolvedUrl,
        status: 0,
        duration: 0,
        size: 0,
        tests: [],
        error: errorMessage,
      });
    } finally {
      setIsSending(false);
    }
  };

  const renderCollectionItems = (items, depth = 0) =>
    items.map((item) => {
      if (item.type === "folder") {
        return (
          <div key={item.id} className="collection-folder">
            <div className="folder-label" style={{ paddingLeft: 12 + depth * 12 }}>
              {item.name}
            </div>
            <div className="folder-children">
              {renderCollectionItems(item.children ?? [], depth + 1)}
            </div>
          </div>
        );
      }
      return (
        <button
          key={item.id}
          type="button"
          className={`collection-item ${
            activeRequestId === item.id ? "active" : ""
          }`}
          style={{ paddingLeft: 12 + depth * 12 }}
          onClick={() => selectRequest(item)}
        >
          <span className={`method-pill method-${item.request.method}`}>
            {item.request.method}
          </span>
          <span className="item-name">{item.name}</span>
        </button>
      );
    });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <div className="app-name">easyPostman</div>
            <div className="app-subtitle">Colecoes locais</div>
          </div>
          <label className="import-button">
            Importar Collection
            <input
              type="file"
              accept=".json"
              onChange={handleImportCollection}
              hidden
            />
          </label>
          <label className="import-button ghost">
            Importar Environment
            <input
              type="file"
              accept=".json"
              onChange={handleImportEnvironment}
              hidden
            />
          </label>
        </div>
        {importError ? <div className="import-error">{importError}</div> : null}
        <div className="collection-list">
          {collections.length === 0 ? (
            <div className="empty-hint">
              Importe uma collection do Postman para comecar.
            </div>
          ) : (
            collections.map((collection) => (
              <div key={collection.id} className="collection-block">
                <div className="collection-title">{collection.name}</div>
                {renderCollectionItems(collection.items)}
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div className="workspace">
            <div className="workspace-title">Workspace Local</div>
          </div>
          <div className="env-select">
            <span>Environment</span>
            <select
              value={activeEnvId}
              onChange={(event) => setActiveEnvId(event.target.value)}
            >
              <option value="">Nenhum</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="content">
          <div className="request-panel">
            <div className="request-title">
              <input
                value={requestDraft.name}
                onChange={(event) =>
                  updateRequest({ name: event.target.value })
                }
                placeholder="Nome da requisicao"
              />
              <span className="request-note">Sem historico remoto</span>
            </div>

            <div className="request-line">
              <div className="request-input-group">
                <select
                  className="method-select"
                  value={requestDraft.method}
                  onChange={(event) =>
                    updateRequest({ method: event.target.value })
                  }
                >
                  {METHOD_OPTIONS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
                <input
                  className="url-input"
                  value={requestDraft.url}
                  onChange={(event) =>
                    updateRequest({ url: event.target.value })
                  }
                  placeholder="https://api.exemplo.com/resource"
                />
              </div>
              <button
                className="send-button"
                type="button"
                onClick={handleSend}
                disabled={isSending || !requestDraft.url}
              >
                {isSending ? "Enviando..." : "Enviar"}
              </button>
            </div>

            <div className="tab-row">
              {["Params", "Headers", "Body", "Scripts"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`tab-button ${
                    activeTab === tab ? "active" : ""
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === "Params" ? (
              <div className="table-grid">
                <div className="table-header">Query Params</div>
                <div className="postman-grid">
                  <div className="table-header-row">
                    <div className="postman-cell checkbox-cell" />
                    <div className="postman-cell">Key</div>
                    <div className="postman-cell">Value</div>
                    <div className="postman-cell">Description</div>
                    <div className="postman-cell bulk-cell">
                      <button type="button" className="bulk-button">
                        Bulk Edit
                      </button>
                    </div>
                  </div>
                  {requestDraft.params.map((param, index) => (
                    <div
                      key={`param-${index}`}
                      className={`postman-row ${
                        param.enabled ? "" : "disabled"
                      }`}
                    >
                      <div className="postman-cell checkbox-cell">
                        <input
                          type="checkbox"
                          checked={param.enabled}
                          onChange={(event) =>
                            updateRowEnabled(
                              "params",
                              index,
                              event.target.checked,
                            )
                          }
                        />
                      </div>
                      <div className="postman-cell">
                        <input
                          value={param.key}
                          placeholder="Key"
                          onChange={(event) =>
                            updateKeyValue(
                              "params",
                              index,
                              "key",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="postman-cell">
                        <input
                          value={param.value}
                          placeholder="Value"
                          onChange={(event) =>
                            updateKeyValue(
                              "params",
                              index,
                              "value",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="postman-cell">
                        <input
                          value={param.description}
                          placeholder="Description"
                          onChange={(event) =>
                            updateKeyValue(
                              "params",
                              index,
                              "description",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="postman-cell bulk-cell">
                        <span className="bulk-placeholder" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "Headers" ? (
              <div className="table-grid">
                <div className="table-header">Headers</div>
                <div className="postman-grid">
                  <div className="table-header-row">
                    <div className="postman-cell checkbox-cell" />
                    <div className="postman-cell">Key</div>
                    <div className="postman-cell">Value</div>
                    <div className="postman-cell">Description</div>
                    <div className="postman-cell bulk-cell">
                      <button type="button" className="bulk-button">
                        Bulk Edit
                      </button>
                    </div>
                  </div>
                  {requestDraft.headers.map((header, index) => (
                    <div
                      key={`header-${index}`}
                      className={`postman-row ${
                        header.enabled ? "" : "disabled"
                      }`}
                    >
                      <div className="postman-cell checkbox-cell">
                        <input
                          type="checkbox"
                          checked={header.enabled}
                          onChange={(event) =>
                            updateRowEnabled(
                              "headers",
                              index,
                              event.target.checked,
                            )
                          }
                        />
                      </div>
                      <div className="postman-cell">
                        <input
                          value={header.key}
                          placeholder="Key"
                          onChange={(event) =>
                            updateKeyValue(
                              "headers",
                              index,
                              "key",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="postman-cell">
                        <input
                          value={header.value}
                          placeholder="Value"
                          onChange={(event) =>
                            updateKeyValue(
                              "headers",
                              index,
                              "value",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="postman-cell">
                        <input
                          value={header.description}
                          placeholder="Description"
                          onChange={(event) =>
                            updateKeyValue(
                              "headers",
                              index,
                              "description",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="postman-cell bulk-cell">
                        <span className="bulk-placeholder" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "Body" ? (
              <div className="body-editor">
                <div className="body-header">Raw</div>
                <textarea
                  value={requestDraft.body}
                  onChange={(event) =>
                    updateRequest({ body: event.target.value })
                  }
                  placeholder='{"exemplo": true}'
                />
              </div>
            ) : null}

            {activeTab === "Scripts" ? (
              <div className="scripts-panel">
                <div className="script-tabs">
                  <button
                    type="button"
                    className={scriptTab === "Pre" ? "active" : ""}
                    onClick={() => setScriptTab("Pre")}
                  >
                    Pre-request Script
                  </button>
                  <button
                    type="button"
                    className={scriptTab === "Tests" ? "active" : ""}
                    onClick={() => setScriptTab("Tests")}
                  >
                    Tests (pm.*)
                  </button>
                </div>
                {scriptTab === "Pre" ? (
                  <textarea
                    value={requestDraft.scripts.pre}
                    onChange={(event) =>
                      updateRequest({
                        scripts: {
                          ...requestDraft.scripts,
                          pre: event.target.value,
                        },
                      })
                    }
                    placeholder="pm.environment.set('token', '...');"
                  />
                ) : (
                  <textarea
                    value={requestDraft.scripts.tests}
                    onChange={(event) =>
                      updateRequest({
                        scripts: {
                          ...requestDraft.scripts,
                          tests: event.target.value,
                        },
                      })
                    }
                    placeholder="pm.test('status 200', () => pm.expect(pm.response.code).toBe(200));"
                  />
                )}
              </div>
            ) : null}
          </div>

          <div className="response-panel">
            <div className="response-header">
              <div className="response-title">Resposta</div>
              <div className="response-meta">
                <button
                  type="button"
                  className="report-button"
                  onClick={downloadReport}
                  disabled={!runs.length}
                >
                  Gerar Report
                </button>
                {response ? (
                  <>
                    <span>Status {response.status}</span>
                    <span>{response.duration} ms</span>
                    <span>{response.size} bytes</span>
                  </>
                ) : (
                  <span>Nenhuma resposta ainda</span>
                )}
              </div>
            </div>
            <div className="response-body">
              {response ? (
                <pre>
                  {(() => {
                    try {
                      const parsed = JSON.parse(response.body || "{}");
                      return JSON.stringify(parsed, null, 2);
                    } catch {
                      return response.body || "";
                    }
                  })()}
                </pre>
              ) : (
                <div className="empty-hint">
                  Envie uma requisicao para visualizar a resposta.
                </div>
              )}
            </div>
            <div className="response-headers">
              <div className="table-header">Headers da resposta</div>
              {response?.headers?.length ? (
                response.headers.map((header, index) => (
                  <div key={`resp-${index}`} className="table-row compact">
                    <span>{header.key}</span>
                    <span>{header.value}</span>
                  </div>
                ))
              ) : (
                <div className="empty-hint">Sem headers</div>
              )}
            </div>
            <div className="tests-panel">
              <div className="table-header">Tests</div>
              {testResults.length ? (
                testResults.map((test, index) => (
                  <div key={`test-${index}`} className="test-row">
                    <span className={test.status}>{test.status}</span>
                    <span>{test.name}</span>
                    {test.error ? (
                      <span className="test-error">{test.error}</span>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="empty-hint">Sem testes executados</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
