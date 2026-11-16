import { useState } from "react";
import { Button, Modal, Segmented, Typography } from "antd";
import { useTranslation } from "react-i18next";

import styles from "./ForgotPasswordModal.module.less";

type Platform = "linux" | "mac" | "windows" | "docker";

function CopyCommand({ text }: { text: string }) {
  return (
    <Typography.Paragraph copyable className={styles.command}>
      {text}
    </Typography.Paragraph>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ForgotPasswordModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<Platform>("linux");

  return (
    <Modal
      open={open}
      title={t("login.forgotPasswordTitle", "Reset password")}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          {t("login.forgotPasswordOk", "Got it")}
        </Button>
      }
      width={520}
      centered
      destroyOnHidden
    >
      <div className={styles.body} data-testid="login-forgot-password">
        <p className={styles.help}>
          {t(
            "login.forgotPasswordHelp",
            "Ask an administrator to reset it under Users. If you manage this host, run the command below on the machine where HiveWork is installed, using the same OS account that runs the service.",
          )}
        </p>
        <CopyCommand
          text={t(
            "login.forgotPasswordCommand",
            "hivework user passwd <username>",
          )}
        />
        <p className={styles.hint}>
          {t(
            "login.forgotPasswordHint",
            "Enter the new password when prompted; input is hidden. You can also pass it with --password. Use at least 8 characters with letters and digits.",
          )}
        </p>
        <Segmented<Platform>
          block
          value={platform}
          onChange={setPlatform}
          options={[
            { label: "Linux", value: "linux" },
            { label: "macOS", value: "mac" },
            { label: "Windows", value: "windows" },
            { label: "Docker", value: "docker" },
          ]}
        />
        <PlatformHelp platform={platform} />
      </div>
    </Modal>
  );
}

function PlatformHelp({ platform }: { platform: Platform }) {
  const { t } = useTranslation();

  if (platform === "docker") {
    return (
      <div className={styles.platform}>
        <p className={styles.note}>
          {t("login.forgotPasswordDocker", "Enter the container, then run:")}
        </p>
        <CopyCommand
          text={t(
            "login.forgotPasswordDockerCommand",
            "docker exec -it <container> hivework user passwd <username>",
          )}
        />
      </div>
    );
  }

  if (platform === "windows") {
    return (
      <div className={styles.platform}>
        <p className={styles.note}>
          {t(
            "login.forgotPasswordWindows",
            "After installing or upgrading, reopen PowerShell or Command Prompt. If hivework is not found, replace <install-directory> below with the actual location, such as D:\\HiveWork:",
          )}
        </p>
        <div className={styles.fallback}>
          <p className={styles.label}>PowerShell</p>
          <CopyCommand
            text={t(
              "login.forgotPasswordWindowsPs",
              '& "<install-directory>\\bin\\hivework.cmd" user passwd "<username>"',
            )}
          />
          <p className={styles.label}>
            {t("login.forgotPasswordWindowsCmdLabel", "Command Prompt")}
          </p>
          <CopyCommand
            text={t(
              "login.forgotPasswordWindowsCmd",
              '"<install-directory>\\bin\\hivework.cmd" user passwd "<username>"',
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.platform}>
      <p className={styles.note}>
        {platform === "mac"
          ? t(
              "login.forgotPasswordMac",
              "Open Terminal (Applications → Utilities → Terminal), then run the command above. If octop is not found:",
            )
          : t(
              "login.forgotPasswordLinux",
              "Open Terminal, then run the command above. If octop is not found:",
            )}
      </p>
      <CopyCommand
        text={t(
          "login.forgotPasswordUnixPath",
          "~/.octop/bin/octop user passwd <username> --password <new-password>",
        )}
      />
    </div>
  );
}
