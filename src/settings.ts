import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { spawn } from "child_process";
import type AIAnnotatePlugin from "./main";

export type ContextStrategy = "full" | "section" | "neighbors";

export interface AIAnnotateSettings {
  claudePath: string;
  timeout: number;
  systemPrompt: string;
  model: string;
  contextStrategy: ContextStrategy;
  extraArgs: string;
  envVars: string;
  recentInstructions: string[];
}

export const DEFAULT_SETTINGS: AIAnnotateSettings = {
  claudePath: "claude",
  timeout: 60,
  systemPrompt: `You are editing a markdown document. Return ONLY the replacement text for the section marked between <!-- TARGET START --> and <!-- TARGET END --> delimiters. Preserve the document's voice and markdown formatting. Do not include line numbers in your response. Do not include the TARGET delimiters in your response. Return only the replacement text, nothing else.`,
  model: "",
  contextStrategy: "neighbors",
  extraArgs: "",
  envVars: "",
  recentInstructions: [],
};

export class AIAnnotateSettingTab extends PluginSettingTab {
  plugin: AIAnnotatePlugin;

  constructor(app: App, plugin: AIAnnotatePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setHeading()
      .setDesc(
        'Write %%AI your instruction %% in any note, then use the command palette to process. Select text and use "annotate selection" for targeted edits.'
      );

    new Setting(containerEl)
      .setName("Claude CLI path")
      .setDesc("Path to the claude binary. Default assumes it is on your path.")
      .addText((text) =>
        text
          .setPlaceholder("Claude")
          .setValue(this.plugin.settings.claudePath)
          .onChange(async (value) => {
            this.plugin.settings.claudePath = value.trim() || DEFAULT_SETTINGS.claudePath;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Test CLI connection")
      .setDesc("Verify that the claude CLI is reachable.")
      .addButton((btn) =>
        btn.setButtonText("Test").onClick(() => {
          const proc = spawn(this.plugin.settings.claudePath, ["--version"], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          let errored = false;
          proc.stdout?.on("data", (d: Buffer) => {
            stdout += d.toString();
          });
          proc.on("error", () => {
            errored = true;
            new Notice(
              `CLI not found at "${this.plugin.settings.claudePath}".`,
              5000
            );
          });
          proc.on("close", (code) => {
            if (errored) return;
            if (code === 0) {
              new Notice(`Claude CLI OK: ${stdout.trim().split("\n")[0]}`, 5000);
            } else {
              new Notice("Claude CLI returned an error. Check the path.", 5000);
            }
          });
        })
      );

    new Setting(containerEl)
      .setName("Timeout")
      .setDesc("Maximum seconds to wait for a claude response.")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.timeout))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.timeout = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("The system prompt sent with every annotation request.")
      .addTextArea((text) => {
        text
          .setPlaceholder("You are editing a Markdown document...")
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc(
        "Optional. Override the default claude model (e.g., claude-sonnet-4-5-20250514). Leave empty to use CLI default."
      )
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Context sent to claude")
      .setDesc(
        "How much of the document to include in each prompt. Smaller context reduces token cost but limits claude's awareness of the full document."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("neighbors", "Target section ± neighbors (default)")
          .addOption("section", "Target section only")
          .addOption("full", "Full document")
          .setValue(this.plugin.settings.contextStrategy)
          .onChange(async (value) => {
            this.plugin.settings.contextStrategy = value as ContextStrategy;
            await this.plugin.saveSettings();
          })
      );

    const advancedHeading = new Setting(containerEl).setName("Advanced").setHeading();
    const descFragment = document.createDocumentFragment();
    const cliRefLink = descFragment.createEl("a", {
      text: "CLI reference",
      href: "https://code.claude.com/docs/en/cli-reference",
    });
    cliRefLink.setAttr("target", "_blank");
    advancedHeading.setDesc(descFragment);

    new Setting(containerEl)
      .setName("Extra CLI arguments")
      .setDesc(
        "Additional arguments passed to the claude process (e.g., --max-turns 5)."
      )
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.extraArgs)
          .onChange(async (value) => {
            this.plugin.settings.extraArgs = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Environment variables")
      .setDesc(
        "One key=value per line. Merged into the CLI process environment."
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.envVars)
          .onChange(async (value) => {
            this.plugin.settings.envVars = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
      });
  }
}
