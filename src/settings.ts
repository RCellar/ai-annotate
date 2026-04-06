import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { spawn } from "child_process";
import type AIAnnotatePlugin from "./main";

export interface AIAnnotateSettings {
  claudePath: string;
  timeout: number;
  systemPrompt: string;
  model: string;
  extraArgs: string;
  envVars: string;
}

export const DEFAULT_SETTINGS: AIAnnotateSettings = {
  claudePath: "claude",
  timeout: 60,
  systemPrompt: `You are editing a markdown document. Return ONLY the replacement text for the section marked between <!-- TARGET START --> and <!-- TARGET END --> delimiters. Preserve the document's voice and markdown formatting. Do not include line numbers in your response. Do not include the TARGET delimiters in your response. Return only the replacement text, nothing else.`,
  model: "",
  extraArgs: "",
  envVars: "",
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
      .setName("AI Annotate")
      .setHeading()
      .setDesc(
        'Write %%ai your instruction %% in any note, then use the command palette to process. Select text and use "Annotate selection" for targeted edits.'
      );

    new Setting(containerEl)
      .setName("Claude CLI path")
      .setDesc("Path to the claude binary. Default assumes it is on your PATH.")
      .addText((text) =>
        text
          .setPlaceholder("claude")
          .setValue(this.plugin.settings.claudePath)
          .onChange(async (value) => {
            this.plugin.settings.claudePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Test CLI connection")
      .setDesc("Verify that the Claude CLI is reachable.")
      .addButton((btn) =>
        btn.setButtonText("Test").onClick(() => {
          const proc = spawn(this.plugin.settings.claudePath, ["--version"], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          proc.stdout?.on("data", (d: Buffer) => {
            stdout += d.toString();
          });
          proc.on("error", () => {
            new Notice(
              `CLI not found at "${this.plugin.settings.claudePath}".`,
              5000
            );
          });
          proc.on("close", (code) => {
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
      .setDesc("Maximum seconds to wait for a Claude response.")
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
          .setPlaceholder("You are editing a markdown document...")
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
        "Optional. Override the default Claude model (e.g., claude-sonnet-4-5-20250514). Leave empty to use CLI default."
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

    new Setting(containerEl).setName("Advanced").setHeading();

    new Setting(containerEl)
      .setName("Extra CLI arguments")
      .setDesc(
        'Additional arguments passed to the claude process (e.g., --max-turns 5 --allowedTools "Edit,Write").'
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
        "One KEY=VALUE per line. Merged into the CLI process environment."
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("CLAUDE_CODE_MAX_MEMORY=1024")
          .setValue(this.plugin.settings.envVars)
          .onChange(async (value) => {
            this.plugin.settings.envVars = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
      });
  }
}
