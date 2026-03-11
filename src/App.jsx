import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
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

const compactRows = (rows) =>
  rows.filter((row) => !isRowEmpty(row));

const normalizeRows = (rows) => {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const normalized = list.map((row) => ({
    ...createKeyValueRow(),
    ...row,
    enabled: row?.enabled !== false,
    description: row?.description ?? "",
  }));
  let trimmed = normalized;
  while (
    trimmed.length > 1 &&
    isRowEmpty(trimmed[trimmed.length - 1]) &&
    isRowEmpty(trimmed[trimmed.length - 2])
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
};

const ensureAtLeastOneRow = (rows) =>
  rows.length ? rows : [createKeyValueRow()];

const createEmptyDraft = () => ({
  name: "Nova requisicao",
  method: "GET",
  url: "",
  params: [createKeyValueRow()],
  headers: [createKeyValueRow()],
  body: "",
  scripts: { pre: "", tests: "" },
});

const buildBulkText = (rows) =>
  rows
    .filter((row) => row.key)
    .map((row) => `${row.key}: ${row.value ?? ""}`)
    .join("\n");

const parseBulkText = (text) => {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = lines.map((line) => {
    let key = line;
    let value = "";
    if (line.includes(":")) {
      const parts = line.split(":");
      key = parts.shift()?.trim() ?? "";
      value = parts.join(":").trim();
    } else if (line.includes("=")) {
      const parts = line.split("=");
      key = parts.shift()?.trim() ?? "";
      value = parts.join("=").trim();
    }
    return createKeyValueRow({ key, value });
  });

  return ensureAtLeastOneRow(normalizeRows(rows));
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

const resolveVariableValue = (key, variables) => {
  if (!variables) return undefined;
  if (Object.prototype.hasOwnProperty.call(variables, key)) {
    return variables[key];
  }
  const keyLower = key.toLowerCase();
  const matchedKey = Object.keys(variables).find(
    (itemKey) => itemKey.toLowerCase() === keyLower,
  );
  if (!matchedKey) return undefined;
  return variables[matchedKey];
};

const resolveVariables = (text, variables, missingKeys) => {
  if (text === null || text === undefined) return "";
  return String(text).replace(/\{\{([^}]+)\}\}/g, (_, rawKey) => {
    const key = rawKey.trim();
    const value = resolveVariableValue(key, variables);
    if (value === undefined || value === null) {
      if (missingKeys) {
        missingKeys.add(key);
      }
      return "";
    }
    return String(value);
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
    return ensureAtLeastOneRow(normalizeRows([]));
  }
  return ensureAtLeastOneRow(
    normalizeRows(
      headers.map((header) => ({
        key: header.key ?? "",
        value: header.value ?? "",
        description:
          typeof header.description === "string" ? header.description : "",
        enabled: !header.disabled,
      })),
    ),
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
    params: ensureAtLeastOneRow(normalizeRows(params)),
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
  const filtered = params.filter((param) => param.key);
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
  const [expandedFolders, setExpandedFolders] = useState({});
  const [expandedCollections, setExpandedCollections] = useState({});
  const [activeFolderId, setActiveFolderId] = useState("");
  const [draftParentId, setDraftParentId] = useState("");
  const [activeCollectionId, setActiveCollectionId] = useState("");
  const [draftCollectionId, setDraftCollectionId] = useState("");
  const [activeTab, setActiveTab] = useState("Params");
  const [scriptTab, setScriptTab] = useState("Pre");
  const [responseTab, setResponseTab] = useState("Body");
  const [response, setResponse] = useState(null);
  const [testResults, setTestResults] = useState([]);
  const [runs, setRuns] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [sidebarTab, setSidebarTab] = useState("collections");
  const [editingFolderId, setEditingFolderId] = useState("");
  const [editingFolderName, setEditingFolderName] = useState("");
  const [editingCollectionId, setEditingCollectionId] = useState("");
  const [editingCollectionName, setEditingCollectionName] = useState("");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState({
    open: false,
    id: "",
    name: "",
  });
  const [envEditorId, setEnvEditorId] = useState("");
  const [envEditorRows, setEnvEditorRows] = useState([createKeyValueRow()]);
  const [bulkEdit, setBulkEdit] = useState({
    params: { open: false, text: "" },
    headers: { open: false, text: "" },
  });
  const [envKeyWidth, setEnvKeyWidth] = useState(180);
  const [paramsKeyWidth, setParamsKeyWidth] = useState(220);
  const [headersKeyWidth, setHeadersKeyWidth] = useState(220);
  const envGridRef = useRef(null);
  const paramsGridRef = useRef(null);
  const headersGridRef = useRef(null);

  useEffect(() => {
    const envStored = Number(localStorage.getItem("envKeyWidth"));
    if (envStored && !Number.isNaN(envStored)) {
      setEnvKeyWidth(envStored);
    }
    const paramsStored = Number(localStorage.getItem("paramsKeyWidth"));
    if (paramsStored && !Number.isNaN(paramsStored)) {
      setParamsKeyWidth(paramsStored);
    }
    const headersStored = Number(localStorage.getItem("headersKeyWidth"));
    if (headersStored && !Number.isNaN(headersStored)) {
      setHeadersKeyWidth(headersStored);
    }
    const sidebarStored = Number(localStorage.getItem("sidebarWidth"));
    if (sidebarStored && !Number.isNaN(sidebarStored)) {
      setSidebarWidth(sidebarStored);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("envKeyWidth", String(envKeyWidth));
  }, [envKeyWidth]);

  useEffect(() => {
    localStorage.setItem("paramsKeyWidth", String(paramsKeyWidth));
  }, [paramsKeyWidth]);

  useEffect(() => {
    localStorage.setItem("headersKeyWidth", String(headersKeyWidth));
  }, [headersKeyWidth]);

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);
  const [isSending, setIsSending] = useState(false);
  const [importError, setImportError] = useState("");

  const [requestDraft, setRequestDraft] = useState(createEmptyDraft());

  const activeEnvironment = useMemo(
    () => environments.find((env) => env.id === activeEnvId),
    [environments, activeEnvId],
  );

  const envValues = activeEnvironment?.values ?? {};

  const updateRequest = (patch) => {
    setRequestDraft((current) => {
      const next = { ...current, ...patch };
      if (patch.params) {
        next.params = ensureAtLeastOneRow(normalizeRows(patch.params));
      }
      if (patch.headers) {
        next.headers = ensureAtLeastOneRow(normalizeRows(patch.headers));
      }
      return next;
    });
    setIsDirty(true);
  };

  const updateRequestName = (name) => {
    setRequestDraft((current) => ({ ...current, name }));
    setIsDirty(true);
  };

  const updateKeyValue = (section, index, field, value) => {
    setRequestDraft((current) => {
      const next = current[section].map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, [field]: value };
      });
      return { ...current, [section]: normalizeRows(next) };
    });
    setIsDirty(true);
  };

  const updateRowEnabled = (section, index, enabled) => {
    setRequestDraft((current) => {
      const next = current[section].map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, enabled };
      });
      return { ...current, [section]: normalizeRows(next) };
    });
    setIsDirty(true);
  };

  const removeRow = (section, index) => {
    setRequestDraft((current) => {
      const rows = current[section].filter((_, rowIndex) => rowIndex !== index);
      const nextRows = ensureAtLeastOneRow(normalizeRows(rows));
      return { ...current, [section]: nextRows };
    });
    setIsDirty(true);
  };

  const focusCell = (section, index, field) => {
    const selector = `[data-section="${section}"][data-index="${index}"][data-field="${field}"]`;
    const target = document.querySelector(selector);
    if (target) {
      target.focus();
    }
  };

  const handleRowKeyDown = (event, section, index, field) => {
    if (event.key !== "Enter" && event.key !== "ArrowDown") return;
    event.preventDefault();

    setRequestDraft((current) => {
      const rows = current[section];
      if (index >= rows.length - 1) {
        const nextRows = normalizeRows([...rows, createKeyValueRow()]);
        return { ...current, [section]: nextRows };
      }
      return current;
    });

    const nextIndex = index + 1;
    setTimeout(() => {
      focusCell(section, nextIndex, field);
    }, 0);
  };

  const toggleBulkEdit = (section) => {
    setBulkEdit((current) => {
      const isOpen = !current[section].open;
      return {
        ...current,
        [section]: {
          open: isOpen,
          text: isOpen ? buildBulkText(requestDraft[section]) : "",
        },
      };
    });
  };

  const updateBulkText = (section, text) => {
    setBulkEdit((current) => ({
      ...current,
      [section]: { ...current[section], text },
    }));
  };

  const applyBulkEdit = (section) => {
    const rows = parseBulkText(bulkEdit[section].text);
    setRequestDraft((current) => ({ ...current, [section]: rows }));
    setBulkEdit((current) => ({
      ...current,
      [section]: { open: false, text: "" },
    }));
    setIsDirty(true);
  };

  const handleImportCollection = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".postman_collection.json")) {
      setImportError("Arquivo inválido. Selecione um .postman_collection.json.");
      event.target.value = "";
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const parsed = parseCollection(data);
      setCollections((current) => [...current, parsed]);
      setExpandedCollections((current) => ({
        ...current,
        [parsed.id]: true,
      }));
      setActiveCollectionId(parsed.id);
      setExpandedFolders((current) => {
        const next = { ...current };
        const markExpanded = (items) => {
          items.forEach((item) => {
            if (item.type === "folder") {
              next[item.id] = true;
              if (item.children?.length) {
                markExpanded(item.children);
              }
            }
          });
        };
        markExpanded(parsed.items ?? []);
        return next;
      });
      setImportError("");
    } catch (error) {
      setImportError("Falha ao importar collection.");
    }
    event.target.value = "";
  };

  const handleImportEnvironment = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      !file.name.endsWith(".postman_environment") &&
      !file.name.endsWith(".postman_environment.json")
    ) {
      setImportError("Arquivo inválido. Selecione um .postman_environment(.json).");
      event.target.value = "";
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const parsed = parseEnvironment(data);
      setEnvironments((current) => [...current, parsed]);
      setActiveEnvId(parsed.id);
      setEnvEditorId(parsed.id);
      setEnvEditorRows(
        ensureAtLeastOneRow(
          normalizeRows(
            Object.entries(parsed.values ?? {}).map(([key, value]) => ({
              key,
              value,
            })),
          ),
        ),
      );
      setImportError("");
    } catch (error) {
      setImportError("Falha ao importar environment.");
    }
    event.target.value = "";
  };

  const selectRequest = (item, collectionId = "", folderId = "") => {
    setActiveRequestId(item.id);
    setActiveCollectionId(collectionId);
    setActiveFolderId(folderId);
    updateRequest({
      name: item.name,
      method: item.request.method,
      url: item.request.url,
      params: ensureAtLeastOneRow(normalizeRows(item.request.params)),
      headers: ensureAtLeastOneRow(normalizeRows(item.request.headers)),
      body: item.request.body,
      scripts: item.scripts ?? { pre: "", tests: "" },
    });
    setIsDirty(false);
    setDraftParentId("");
    setDraftCollectionId("");
    setResponse(null);
    setTestResults([]);
  };

  const createNewRequest = () => {
    setActiveRequestId("");
    setRequestDraft(createEmptyDraft());
    setIsDirty(false);
    setDraftParentId(activeFolderId || "");
    setDraftCollectionId(activeFolderId ? "" : activeCollectionId || "");
    setResponse(null);
    setTestResults([]);
  };

  const createCollection = () => {
    const newCollection = {
      id: createId(),
      name: "Nova Collection",
      items: [],
    };
    setCollections((current) => [newCollection, ...current]);
    setActiveCollectionId(newCollection.id);
    setExpandedCollections((current) => ({
      ...current,
      [newCollection.id]: true,
    }));
  };

  const createFolder = () => {
    let folderId = "";
    setCollections((current) => {
      const next = [...current];
      folderId = createId();
      const newFolder = {
        id: folderId,
        type: "folder",
        name: "Nova Pasta",
        children: [],
      };

      const insertIntoFolder = (items) =>
        items.map((item) => {
          if (item.type === "folder" && item.id === activeFolderId) {
            return {
              ...item,
              children: [...(item.children ?? []), newFolder],
            };
          }
          if (item.type === "folder") {
            return {
              ...item,
              children: insertIntoFolder(item.children ?? []),
            };
          }
          return item;
        });

      if (activeFolderId) {
        return next.map((collection) => ({
          ...collection,
          items: insertIntoFolder(collection.items ?? []),
        }));
      }

      if (activeCollectionId) {
        return next.map((collection) =>
          collection.id === activeCollectionId
            ? {
                ...collection,
                items: [...(collection.items ?? []), newFolder],
              }
            : collection,
        );
      }

      const localIndex = next.findIndex(
        (collection) => collection.name === "Local",
      );
      const localCollection =
        localIndex >= 0
          ? next[localIndex]
          : {
              id: createId(),
              name: "Local",
              items: [],
            };
      const updatedLocal = {
        ...localCollection,
        items: [...(localCollection.items ?? []), newFolder],
      };
      if (localIndex >= 0) {
        next[localIndex] = updatedLocal;
        return next;
      }
      return [updatedLocal, ...next];
    });
    if (folderId) {
      setExpandedFolders((current) => ({
        ...current,
        [folderId]: true,
      }));
    }
  };

  const selectFolder = (folderId, collectionId) => {
    setActiveFolderId(folderId);
    setActiveCollectionId(collectionId);
    setActiveRequestId("");
  };

  const startEditFolder = (folder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  const startEditCollection = (collection) => {
    setEditingCollectionId(collection.id);
    setEditingCollectionName(collection.name);
  };

  const commitEditFolder = () => {
    const name = editingFolderName.trim();
    if (!editingFolderId || !name) {
      setEditingFolderId("");
      setEditingFolderName("");
      return;
    }
    setCollections((current) => {
      const updateItems = (items) =>
        items.map((item) => {
          if (item.type === "folder" && item.id === editingFolderId) {
            return { ...item, name };
          }
          if (item.type === "folder") {
            return {
              ...item,
              children: updateItems(item.children ?? []),
            };
          }
          return item;
        });
      return current.map((collection) => ({
        ...collection,
        items: updateItems(collection.items ?? []),
      }));
    });
    setEditingFolderId("");
    setEditingFolderName("");
  };

  const commitEditCollection = () => {
    const name = editingCollectionName.trim();
    if (!editingCollectionId || !name) {
      setEditingCollectionId("");
      setEditingCollectionName("");
      return;
    }
    setCollections((current) =>
      current.map((collection) =>
        collection.id === editingCollectionId
          ? { ...collection, name }
          : collection,
      ),
    );
    setEditingCollectionId("");
    setEditingCollectionName("");
  };

  const mapEnvRowsToValues = (rows) => {
    const values = {};
    compactRows(normalizeRows(rows)).forEach((row) => {
      if (row.key) {
        values[row.key] = row.value ?? "";
      }
    });
    return values;
  };

  const selectEnvironmentForEdit = (env) => {
    setEnvEditorId(env.id);
    setEnvEditorRows(
      ensureAtLeastOneRow(
        normalizeRows(
          Object.entries(env.values ?? {}).map(([key, value]) => ({
            key,
            value,
          })),
        ),
      ),
    );
  };

  const updateEnvironmentValues = (rows) => {
    if (!envEditorId) return;
    const values = mapEnvRowsToValues(rows);
    setEnvironments((current) =>
      current.map((env) =>
        env.id === envEditorId ? { ...env, values } : env,
      ),
    );
  };

  const updateEnvRow = (index, field, value) => {
    setEnvEditorRows((current) => {
      const next = current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, [field]: value };
      });
      const normalized = normalizeRows(next);
      updateEnvironmentValues(normalized);
      return normalized;
    });
  };

  const handleEnvRowKeyDown = (event, index, field) => {
    if (event.key !== "Enter" && event.key !== "ArrowDown") return;
    event.preventDefault();
    setEnvEditorRows((current) => {
      if (index >= current.length - 1) {
        const nextRows = normalizeRows([...current, createKeyValueRow()]);
        updateEnvironmentValues(nextRows);
        return nextRows;
      }
      return current;
    });
    const nextIndex = index + 1;
    setTimeout(() => {
      const selector = `[data-env-index="${nextIndex}"][data-env-field="${field}"]`;
      const target = document.querySelector(selector);
      if (target) target.focus();
    }, 0);
  };

  const removeEnvRow = (index) => {
    setEnvEditorRows((current) => {
      const rows = current.filter((_, rowIndex) => rowIndex !== index);
      const nextRows = ensureAtLeastOneRow(normalizeRows(rows));
      updateEnvironmentValues(nextRows);
      return nextRows;
    });
  };

  const startEnvResize = (event) => {
    event.preventDefault();
    const grid = envGridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = envKeyWidth;
    const min = 120;
    const max = Math.max(200, rect.width - 36 - 120);

    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.min(max, Math.max(min, startWidth + delta));
      setEnvKeyWidth(next);
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const startParamsResize = (event) => {
    event.preventDefault();
    const grid = paramsGridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = paramsKeyWidth;
    const min = 140;
    const max = Math.max(220, rect.width - 90 - 120);

    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.min(max, Math.max(min, startWidth + delta));
      setParamsKeyWidth(next);
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const startHeadersResize = (event) => {
    event.preventDefault();
    const grid = headersGridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = headersKeyWidth;
    const min = 140;
    const max = Math.max(220, rect.width - 90 - 120);

    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.min(max, Math.max(min, startWidth + delta));
      setHeadersKeyWidth(next);
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const startSidebarResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const min = 220;
    const max = 420;

    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = Math.min(max, Math.max(min, startWidth + delta));
      setSidebarWidth(next);
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const removeRequestById = (items, id) =>
    items
      .filter((item) => !(item.type === "request" && item.id === id))
      .map((item) => {
        if (item.type === "folder") {
          return {
            ...item,
            children: removeRequestById(item.children ?? [], id),
          };
        }
        return item;
      });

  const askDeleteRequest = (item) => {
    setConfirmDelete({ open: true, id: item.id, name: item.name });
  };

  const cancelDeleteRequest = () => {
    setConfirmDelete({ open: false, id: "", name: "" });
  };

  const confirmDeleteRequest = () => {
    const requestId = confirmDelete.id;
    if (!requestId) return;
    setCollections((current) =>
      current.map((collection) => ({
        ...collection,
        items: removeRequestById(collection.items ?? [], requestId),
      })),
    );
    if (activeRequestId === requestId) {
      createNewRequest();
    }
    cancelDeleteRequest();
  };

  const commitEnvValues = (values) => {
    if (!activeEnvId) return;
    setEnvironments((current) =>
      current.map((env) =>
        env.id === activeEnvId ? { ...env, values } : env,
      ),
    );
  };

  const buildDraftPayload = () => ({
    name: requestDraft.name,
    request: {
      method: requestDraft.method,
      url: requestDraft.url,
      params: compactRows(normalizeRows(requestDraft.params)),
      headers: compactRows(normalizeRows(requestDraft.headers)),
      body: requestDraft.body,
    },
    scripts: requestDraft.scripts ?? { pre: "", tests: "" },
  });

  const saveRequest = () => {
    const payload = buildDraftPayload();
    const newRequestId = activeRequestId || createId();

    setCollections((current) => {
      const updateItems = (items) =>
        items.map((item) => {
          if (item.type === "request" && item.id === activeRequestId) {
            return { ...item, ...payload };
          }
          if (item.type === "folder") {
            return {
              ...item,
              children: updateItems(item.children ?? []),
            };
          }
          return item;
        });

      if (activeRequestId) {
        return current.map((collection) => ({
          ...collection,
          items: updateItems(collection.items ?? []),
        }));
      }

      if (draftParentId) {
        const insertIntoFolder = (items) =>
          items.map((item) => {
            if (item.type === "folder" && item.id === draftParentId) {
              return {
                ...item,
                children: [
                  ...(item.children ?? []),
                  {
                    id: newRequestId,
                    type: "request",
                    ...payload,
                  },
                ],
              };
            }
            if (item.type === "folder") {
              return {
                ...item,
                children: insertIntoFolder(item.children ?? []),
              };
            }
            return item;
          });
        return current.map((collection) => ({
          ...collection,
          items: insertIntoFolder(collection.items ?? []),
        }));
      }

      if (draftCollectionId) {
        return current.map((collection) =>
          collection.id === draftCollectionId
            ? {
                ...collection,
                items: [
                  ...(collection.items ?? []),
                  {
                    id: newRequestId,
                    type: "request",
                    ...payload,
                  },
                ],
              }
            : collection,
        );
      }

      const localIndex = current.findIndex(
        (collection) => collection.name === "Local",
      );
      const localCollection =
        localIndex >= 0
          ? current[localIndex]
          : {
              id: createId(),
              name: "Local",
              items: [],
            };

      const newItem = {
        id: newRequestId,
        type: "request",
        ...payload,
      };

      const updatedLocal = {
        ...localCollection,
        items: [...(localCollection.items ?? []), newItem],
      };

      if (localIndex >= 0) {
        return current.map((collection, index) =>
          index === localIndex ? updatedLocal : collection,
        );
      }
      return [updatedLocal, ...current];
    });

    setActiveRequestId(newRequestId);
    setIsDirty(false);
    setDraftParentId("");
    setDraftCollectionId("");
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
    setResponseTab("Body");
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
    const missingVariables = new Set();
    const resolvedParams = requestDraft.params
      .filter((param) => param.enabled && param.key)
      .map((param) => ({
        key: resolveVariables(param.key, resolvedEnv, missingVariables),
        value: resolveVariables(param.value, resolvedEnv, missingVariables),
      }));
    const resolvedUrl = buildUrlWithParams(
      resolveVariables(requestDraft.url, resolvedEnv, missingVariables),
      resolvedParams,
    );
    const resolvedHeaders = requestDraft.headers
      .filter((header) => header.enabled && header.key)
      .map((header) => ({
        key: resolveVariables(header.key, resolvedEnv, missingVariables),
        value: resolveVariables(header.value, resolvedEnv, missingVariables),
      }));
    const resolvedBody = resolveVariables(
      requestDraft.body,
      resolvedEnv,
      missingVariables,
    );

    if (missingVariables.size > 0) {
      const missingList = Array.from(missingVariables).join(", ");
      const message = `Variavel(is) nao encontrada(s) no environment ativo: ${missingList}`;
      setResponse({
        status: 0,
        status_text: "Erro",
        headers: [],
        body: message,
        duration: 0,
        size: 0,
      });
      setIsSending(false);
      return;
    }

    const start = performance.now();
    try {
      const result = await invoke("send_request", {
        payload: {
          method: requestDraft.method,
          url: resolvedUrl,
          headers: resolvedHeaders,
          body: resolvedBody,
        },
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
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || JSON.stringify(error) || "Falha ao enviar requisicao.";
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

  const toggleFolder = (folderId) => {
    setExpandedFolders((current) => ({
      ...current,
      [folderId]: !current[folderId],
    }));
  };

  const toggleCollection = (collectionId) => {
    setExpandedCollections((current) => ({
      ...current,
      [collectionId]: !current[collectionId],
    }));
  };

  const renderCollectionItems = (
    items,
    depth = 0,
    collectionId = "",
    parentId = "",
  ) =>
    items.map((item) => {
      if (item.type === "folder") {
        const isOpen = expandedFolders[item.id] ?? false;
        return (
          <div key={item.id} className="collection-folder">
            <div
              className={`folder-row ${
                activeFolderId === item.id ? "active" : ""
              }`}
              style={{ paddingLeft: 12 + depth * 12 }}
            >
              <button
                type="button"
                className={`folder-caret ${isOpen ? "open" : ""}`}
                onClick={() => toggleFolder(item.id)}
                aria-label="Expandir pasta"
              >
                ▶
              </button>
              {editingFolderId === item.id ? (
                <input
                  className="folder-input"
                  value={editingFolderName}
                  onChange={(event) =>
                    setEditingFolderName(event.target.value)
                  }
                  onBlur={commitEditFolder}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitEditFolder();
                    }
                    if (event.key === "Escape") {
                      setEditingFolderId("");
                      setEditingFolderName("");
                    }
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="folder-name"
                  onClick={() => selectFolder(item.id, collectionId)}
                  onDoubleClick={() => startEditFolder(item)}
                >
                  {item.name}
                </button>
              )}
            </div>
            {isOpen ? (
              <div className="folder-children">
                {renderCollectionItems(
                  item.children ?? [],
                  depth + 1,
                  collectionId,
                  item.id,
                )}
              </div>
            ) : null}
          </div>
        );
      }
      return (
        <div
          key={item.id}
          className={`collection-item-row ${
            activeRequestId === item.id ? "active" : ""
          }`}
          style={{ paddingLeft: 12 + depth * 12 }}
        >
          <button
            type="button"
            className={`collection-item ${
              activeRequestId === item.id ? "active" : ""
            }`}
            onClick={() => selectRequest(item, collectionId, parentId)}
          >
            <span className={`method-pill method-${item.request.method}`}>
              {item.request.method}
            </span>
            <span className="item-name">{item.name}</span>
          </button>
          <button
            type="button"
            className="item-delete"
            onClick={(event) => {
              event.stopPropagation();
              askDeleteRequest(item);
            }}
            aria-label="Excluir request"
          />
        </div>
      );
    });

  const filteredCollections = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return collections;

    const filterItems = (items) =>
      items
        .map((item) => {
          if (item.type === "folder") {
            const children = filterItems(item.children ?? []);
            const match = item.name.toLowerCase().includes(term);
            if (match) {
              return { ...item, children: item.children ?? [] };
            }
            if (children.length) {
              return { ...item, children };
            }
            return null;
          }
          if (item.type === "request") {
            return item.name.toLowerCase().includes(term) ? item : null;
          }
          return null;
        })
        .filter(Boolean);

    return collections
      .map((collection) => {
        const match = collection.name.toLowerCase().includes(term);
        if (match) return collection;
        const items = filterItems(collection.items ?? []);
        if (!items.length) return null;
        return { ...collection, items };
      })
      .filter(Boolean);
  }, [collections, searchTerm]);

  return (
    <div className="app-shell">
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar-header">
          <div>
            <div className="app-name">easyPostman</div>
            <div className="app-subtitle">Colecoes locais</div>
          </div>
          <div className="sidebar-actions">
            <div className="create-menu">
              <button
                type="button"
                className="create-button"
                onClick={() => setCreateMenuOpen((open) => !open)}
                aria-label="Criar"
              >
                +
              </button>
              {createMenuOpen ? (
                <div className="create-dropdown">
                  <button
                    type="button"
                    onClick={() => {
                      createNewRequest();
                      setCreateMenuOpen(false);
                    }}
                  >
                    Request
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      createCollection();
                      setCreateMenuOpen(false);
                    }}
                  >
                    Collection
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      createFolder();
                      setCreateMenuOpen(false);
                    }}
                  >
                    Pastas
                  </button>
                  <label className="dropdown-item">
                    Importar Collection
                    <input
                      type="file"
                      accept=".postman_collection.json"
                      onChange={(event) => {
                        handleImportCollection(event);
                        setCreateMenuOpen(false);
                      }}
                      hidden
                    />
                  </label>
                  <label className="dropdown-item">
                    Importar Environment
                    <input
                      type="file"
                      accept=".postman_environment.json"
                      onChange={(event) => {
                        handleImportEnvironment(event);
                        setCreateMenuOpen(false);
                      }}
                      hidden
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <input
              className="sidebar-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Pesquisar requests..."
            />
          </div>
        </div>
        {importError ? <div className="import-error">{importError}</div> : null}
        <div className="sidebar-tabs">
          <button
            type="button"
            className={sidebarTab === "collections" ? "active" : ""}
            onClick={() => setSidebarTab("collections")}
          >
            Collections
          </button>
          <button
            type="button"
            className={sidebarTab === "environments" ? "active" : ""}
            onClick={() => setSidebarTab("environments")}
          >
            Environments
          </button>
        </div>
        {sidebarTab === "collections" ? (
          <div className="collection-list">
            {filteredCollections.length === 0 ? (
              <div className="empty-hint">
                Importe uma collection do Postman para comecar.
              </div>
            ) : (
              filteredCollections.map((collection) => {
                const isOpen = searchTerm.trim()
                  ? true
                  : expandedCollections[collection.id] ?? true;
                return (
                  <div key={collection.id} className="collection-block">
                    <div className="collection-header">
                      <button
                        type="button"
                        className={`collection-caret ${isOpen ? "open" : ""}`}
                        onClick={() => toggleCollection(collection.id)}
                        aria-label="Expandir collection"
                      >
                        ▶
                      </button>
                      {editingCollectionId === collection.id ? (
                        <input
                          className="collection-input"
                          value={editingCollectionName}
                          onChange={(event) =>
                            setEditingCollectionName(event.target.value)
                          }
                          onBlur={commitEditCollection}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              commitEditCollection();
                            }
                            if (event.key === "Escape") {
                              setEditingCollectionId("");
                              setEditingCollectionName("");
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          className={`collection-title ${
                            activeCollectionId === collection.id ? "active" : ""
                          }`}
                          onClick={() => {
                            setActiveCollectionId(collection.id);
                            setActiveFolderId("");
                          }}
                          onDoubleClick={() => startEditCollection(collection)}
                        >
                          {collection.name}
                        </button>
                      )}
                    </div>
                    {isOpen
                      ? renderCollectionItems(
                          collection.items,
                          0,
                          collection.id,
                          "",
                        )
                      : null}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="env-panel">
            <div className="env-list">
              {environments.length === 0 ? (
                <div className="empty-hint">
                  Importe environments para editar.
                </div>
              ) : (
                environments.map((env) => (
                  <button
                    key={env.id}
                    type="button"
                    className={`env-item ${
                      envEditorId === env.id ? "active" : ""
                    }`}
                    onClick={() => selectEnvironmentForEdit(env)}
                  >
                    {env.name}
                  </button>
                ))
              )}
            </div>
            {envEditorId ? (
              <div className="env-editor">
                <div className="table-header">Variaveis</div>
                <div
                  className="postman-grid env-grid"
                  ref={envGridRef}
                  style={{ "--env-key-width": `${envKeyWidth}px` }}
                >
                  <div className="table-header-row env-header">
                    <div className="postman-cell">Key</div>
                    <div className="postman-cell">Value</div>
                    <div className="postman-cell bulk-cell" />
                    <div
                      className="env-resizer"
                      onMouseDown={startEnvResize}
                    />
                  </div>
                  {envEditorRows.map((row, index) => (
                    <div key={`env-${index}`} className="postman-row env-row">
                      <div className="postman-cell">
                        <input
                          value={row.key}
                          placeholder="Key"
                          onChange={(event) =>
                            updateEnvRow(index, "key", event.target.value)
                          }
                          onKeyDown={(event) =>
                            handleEnvRowKeyDown(event, index, "key")
                          }
                          data-env-index={index}
                          data-env-field="key"
                        />
                      </div>
                      <div className="postman-cell">
                        <input
                          value={row.value}
                          placeholder="Value"
                          onChange={(event) =>
                            updateEnvRow(index, "value", event.target.value)
                          }
                          onKeyDown={(event) =>
                            handleEnvRowKeyDown(event, index, "value")
                          }
                          data-env-index={index}
                          data-env-field="value"
                        />
                      </div>
                      <div className="postman-cell bulk-cell">
                        <button
                          type="button"
                          className="row-delete"
                          onClick={() => removeEnvRow(index)}
                          disabled={
                            envEditorRows.length === 1 && isRowEmpty(row)
                          }
                          aria-label="Excluir linha"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </aside>
      <div className="sidebar-resizer" onMouseDown={startSidebarResize} />

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
                  updateRequestName(event.target.value)
                }
                placeholder="Nome da requisicao"
              />
              <div className="request-actions">
                <button
                  type="button"
                  className="save-button"
                  onClick={saveRequest}
                  disabled={!isDirty}
                >
                  Salvar
                </button>
              </div>
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

            <div className="tab-row request-tabs">
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
                <div
                  className="postman-grid params-grid"
                  ref={paramsGridRef}
                  style={{ "--params-key-width": `${paramsKeyWidth}px` }}
                >
                  <div className="table-header-row params-header">
                    <div className="postman-cell checkbox-cell" />
                    <div className="postman-cell">Key</div>
                    <div className="postman-cell">Value</div>
                    <div className="postman-cell">Description</div>
                    <div className="postman-cell bulk-cell">
                      <button
                        type="button"
                        className="bulk-button"
                        onClick={() => toggleBulkEdit("params")}
                      >
                        Bulk Edit
                      </button>
                    </div>
                    <div
                      className="grid-resizer"
                      onMouseDown={startParamsResize}
                    />
                  </div>
                  {bulkEdit.params.open ? (
                    <div className="bulk-editor">
                      <textarea
                        value={bulkEdit.params.text}
                        onChange={(event) =>
                          updateBulkText("params", event.target.value)
                        }
                        placeholder="key: value"
                      />
                      <div className="bulk-actions">
                        <button
                          type="button"
                          className="bulk-apply"
                          onClick={() => applyBulkEdit("params")}
                        >
                          Aplicar
                        </button>
                        <button
                          type="button"
                          className="bulk-cancel"
                          onClick={() => toggleBulkEdit("params")}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {requestDraft.params.map((param, index) => (
                    <div
                      key={`param-${index}`}
                      className={`postman-row params-row ${
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
                          onKeyDown={(event) =>
                            handleRowKeyDown(event, "params", index, "key")
                          }
                          data-section="params"
                          data-index={index}
                          data-field="key"
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
                          onKeyDown={(event) =>
                            handleRowKeyDown(event, "params", index, "value")
                          }
                          data-section="params"
                          data-index={index}
                          data-field="value"
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
                          onKeyDown={(event) =>
                            handleRowKeyDown(
                              event,
                              "params",
                              index,
                              "description",
                            )
                          }
                          data-section="params"
                          data-index={index}
                          data-field="description"
                        />
                      </div>
                      <div className="postman-cell bulk-cell">
                        <button
                          type="button"
                          className="row-delete"
                          onClick={() => removeRow("params", index)}
                          disabled={
                            requestDraft.params.length === 1 &&
                            isRowEmpty(param)
                          }
                          aria-label="Excluir linha"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "Headers" ? (
              <div className="table-grid">
                <div className="table-header">Headers</div>
                <div
                  className="postman-grid headers-grid"
                  ref={headersGridRef}
                  style={{ "--headers-key-width": `${headersKeyWidth}px` }}
                >
                  <div className="table-header-row headers-header">
                    <div className="postman-cell checkbox-cell" />
                    <div className="postman-cell">Header</div>
                    <div className="postman-cell">Value</div>
                    <div className="postman-cell">Description</div>
                    <div className="postman-cell bulk-cell">
                      <button
                        type="button"
                        className="bulk-button"
                        onClick={() => toggleBulkEdit("headers")}
                      >
                        Bulk Edit
                      </button>
                    </div>
                    <div
                      className="grid-resizer"
                      onMouseDown={startHeadersResize}
                    />
                  </div>
                  {bulkEdit.headers.open ? (
                    <div className="bulk-editor">
                      <textarea
                        value={bulkEdit.headers.text}
                        onChange={(event) =>
                          updateBulkText("headers", event.target.value)
                        }
                        placeholder="key: value"
                      />
                      <div className="bulk-actions">
                        <button
                          type="button"
                          className="bulk-apply"
                          onClick={() => applyBulkEdit("headers")}
                        >
                          Aplicar
                        </button>
                        <button
                          type="button"
                          className="bulk-cancel"
                          onClick={() => toggleBulkEdit("headers")}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {requestDraft.headers.map((header, index) => (
                    <div
                      key={`header-${index}`}
                      className={`postman-row headers-row ${
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
                          placeholder="Header"
                          onChange={(event) =>
                            updateKeyValue(
                              "headers",
                              index,
                              "key",
                              event.target.value,
                            )
                          }
                          onKeyDown={(event) =>
                            handleRowKeyDown(event, "headers", index, "key")
                          }
                          data-section="headers"
                          data-index={index}
                          data-field="key"
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
                          onKeyDown={(event) =>
                            handleRowKeyDown(event, "headers", index, "value")
                          }
                          data-section="headers"
                          data-index={index}
                          data-field="value"
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
                          onKeyDown={(event) =>
                            handleRowKeyDown(
                              event,
                              "headers",
                              index,
                              "description",
                            )
                          }
                          data-section="headers"
                          data-index={index}
                          data-field="description"
                        />
                      </div>
                      <div className="postman-cell bulk-cell">
                        <button
                          type="button"
                          className="row-delete"
                          onClick={() => removeRow("headers", index)}
                          disabled={
                            requestDraft.headers.length === 1 &&
                            isRowEmpty(header)
                          }
                          aria-label="Excluir linha"
                        />
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
                  <div className="code-editor">
                    <CodeMirror
                      value={requestDraft.scripts.pre}
                      height="200px"
                      theme={oneDark}
                      extensions={[javascript()]}
                      onChange={(value) =>
                        updateRequest({
                          scripts: {
                            ...requestDraft.scripts,
                            pre: value,
                          },
                        })
                      }
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: false,
                      }}
                    />
                  </div>
                ) : (
                  <div className="code-editor">
                    <CodeMirror
                      value={requestDraft.scripts.tests}
                      height="200px"
                      theme={oneDark}
                      extensions={[javascript()]}
                      onChange={(value) =>
                        updateRequest({
                          scripts: {
                            ...requestDraft.scripts,
                            tests: value,
                          },
                        })
                      }
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: false,
                      }}
                    />
                  </div>
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
            <div className="tab-row response-tabs">
              <button
                type="button"
                className={`tab-button ${responseTab === "Body" ? "active" : ""}`}
                onClick={() => setResponseTab("Body")}
              >
                Body
              </button>
              <button
                type="button"
                className={`tab-button ${responseTab === "Headers" ? "active" : ""}`}
                onClick={() => setResponseTab("Headers")}
              >
                Headers
              </button>
              <button
                type="button"
                className={`tab-button ${responseTab === "Tests" ? "active" : ""}`}
                onClick={() => setResponseTab("Tests")}
              >
                Tests
              </button>
            </div>
            {responseTab === "Body" ? (
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
            ) : null}
            {responseTab === "Headers" ? (
              <div className="response-body response-table">
                {response?.headers?.length ? (
                  response.headers.map((header, index) => (
                    <div key={`resp-${index}`} className="table-row compact">
                      <span>{header.key}</span>
                      <span>{header.value}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-hint">Sem headers na resposta.</div>
                )}
              </div>
            ) : null}
            {responseTab === "Tests" ? (
              <div className="response-body response-tests">
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
                  <div className="empty-hint">Sem testes executados.</div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </section>
      {confirmDelete.open ? (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-title">Excluir request?</div>
            <div className="modal-body">
              Tem certeza que deseja excluir "{confirmDelete.name}"?
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-cancel"
                onClick={cancelDeleteRequest}
              >
                Nao
              </button>
              <button
                type="button"
                className="modal-confirm"
                onClick={confirmDeleteRequest}
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
