import { useTranslation } from "react-i18next";
import { Tooltip } from "antd";
import { useUpdateStatus } from "../../hooks/useUpdateStatus";
import styles from "./index.module.less";

export default function CurrentVersionBadge() {
  const { t } = useTranslation();
  const { status } = useUpdateStatus();

  const version = status?.current_version;
  if (!version) return null;

  const tooltip = t("header.currentVersion", { version });
  const label = `v${version}`;

  return (
    <Tooltip title={tooltip} mouseEnterDelay={0.35}>
      <span className={styles.versionBadge} aria-label={tooltip}>
        {label}
      </span>
    </Tooltip>
  );
}
