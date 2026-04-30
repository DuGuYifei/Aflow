import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowDefinition } from "@specflow/core";

export interface SpecflowKnowledge {
  files: SpecflowKnowledgeFile[];
}

export interface SpecflowKnowledgeFile {
  path: string;
  content: string;
}

export interface SpecflowWorkflowDefinitionFile {
  path: string;
  definition: WorkflowDefinition;
}

export async function readSpecflowFile(
  root: string,
  relativePath: string
): Promise<string> {
  return readFile(join(root, ".specflow", relativePath), "utf8");
}

async function listMarkdownFiles(
  root: string,
  relativeDirectory = ""
): Promise<string[]> {
  return listSpecflowFiles(root, ".md", relativeDirectory);
}

async function listWorkflowDefinitionFiles(root: string): Promise<string[]> {
  return listSpecflowFiles(root, ".workflow.json", "workflows");
}

async function listSpecflowFiles(
  root: string,
  suffix: string,
  relativeDirectory = ""
): Promise<string[]> {
  const absoluteDirectory = join(root, ".specflow", relativeDirectory);
  let entries;

  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = join(relativeDirectory, entry.name);

      if (entry.name === "runs") {
        return [];
      }

      if (entry.isDirectory()) {
        return listSpecflowFiles(root, suffix, relativePath);
      }

      if (entry.isFile() && entry.name.endsWith(suffix)) {
        return [relativePath.replaceAll("\\", "/")];
      }

      return [];
    })
  );

  return files.flat().sort();
}

export async function readSpecflowKnowledge(root: string): Promise<SpecflowKnowledge> {
  const paths = await listMarkdownFiles(root);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readSpecflowFile(root, path)
    }))
  );

  return { files };
}

export async function readSpecflowWorkflowDefinitions(
  root: string
): Promise<SpecflowWorkflowDefinitionFile[]> {
  const paths = await listWorkflowDefinitionFiles(root);

  return Promise.all(
    paths.map(async (path) => ({
      path,
      definition: JSON.parse(await readSpecflowFile(root, path)) as WorkflowDefinition
    }))
  );
}

export async function updateSpecflowKnowledgePlaceholder(): Promise<never> {
  throw new Error("Writing .specflow knowledge is not implemented yet.");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
