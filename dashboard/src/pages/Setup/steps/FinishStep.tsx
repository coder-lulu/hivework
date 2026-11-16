import { useEffect, useState } from "react";
import { Spin, Alert, Button, Typography, Space } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { authApi, isMfaChallenge } from "../../../api/modules/auth";
import { setAuthToken } from "../../../api/request";
import { refreshServerLabels } from "../../../i18n";
import { applyUserLocale } from "../../../utils/locale";
import {
  wizardApi,
  wizardSession,
  resolveSetupProbeToken,
} from "../wizardClient";
import type { ProviderDraft } from "../wizardClient";
import type { AdminCreds } from "./AdminStep";

const { Text, Paragraph } = Typography;

interface Props {
  adminCreds: AdminCreds;
  providerDraft: ProviderDraft | null;
}

export default function FinishStep({ adminCreds, providerDraft }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [running, setRunning] = useState(true);
  const [errors, setErrors] = useState<{ login?: string; provider?: string }>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wizardToken = await resolveSetupProbeToken();
      if (cancelled) return;

      if (wizardToken) {
        try {
          await wizardApi.finish(
            { provider_draft: providerDraft },
            wizardToken,
          );
        } catch (e) {
          if (!cancelled) {
            setErrors((s) => ({
              ...s,
              provider: e instanceof Error ? e.message : String(e),
            }));
          }
        }
      } else if (!wizardToken && !cancelled) {
        setErrors((s) => ({
          ...s,
          provider: "session-expired",
        }));
      }

      if (cancelled) return;
      try {
        if (adminCreds.password) {
          const r = await authApi.login(
            adminCreds.username,
            adminCreds.password,
          );
          if (isMfaChallenge(r)) {
            throw new Error("mfa-required");
          }
          setAuthToken(r.access_token);
          await applyUserLocale(r.user.locale);
          void refreshServerLabels(r.user.locale);
        } else {
          // No password gate: the JWT minted at initial-admin is the session.
          const token = wizardSession.loadSetupJwt();
          if (!token) throw new Error("session-expired");
          setAuthToken(token);
          const me = await authApi.me();
          await applyUserLocale(me.locale);
          void refreshServerLabels(me.locale);
        }
      } catch (e) {
        if (!cancelled) {
          setErrors((s) => ({
            ...s,
            login: e instanceof Error ? e.message : String(e),
          }));
          setRunning(false);
        }
        return;
      }

      if (!cancelled) {
        wizardSession.clearAll();
        setRunning(false);
        if (!adminCreds.generatedPassword) {
          setTimeout(() => {
            if (!cancelled) navigate("/chat", { replace: true });
          }, 400);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminCreds, providerDraft, navigate]);

  if (running && !errors.login) {
    return (
      <Space direction="vertical" align="center" style={{ width: "100%" }}>
        <Spin />
        <Text type="secondary">{t("wizard.finish.running")}</Text>
      </Space>
    );
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {adminCreds.generatedPassword && (
        <>
          <Alert
            type="success"
            showIcon
            message={t("wizard.finish.credentialsTitle")}
            description={t("wizard.finish.credentialsHint")}
          />
          <div>
            <Text type="secondary">{t("wizard.admin.username")}</Text>
            <Paragraph copyable>{adminCreds.username}</Paragraph>
            <Text type="secondary">{t("wizard.admin.password")}</Text>
            <Paragraph
              copyable={{ text: adminCreds.generatedPassword }}
              style={{ wordBreak: "break-all", marginBottom: 0 }}
            >
              <Text code style={{ whiteSpace: "normal" }}>
                {adminCreds.generatedPassword}
              </Text>
            </Paragraph>
          </div>
        </>
      )}
      {errors.login && (
        <Alert type="error" showIcon message={t("wizard.finish.loginFailed")} />
      )}
      {errors.provider && !errors.login && (
        <Alert
          type="warning"
          showIcon
          message={t("wizard.finish.providerFailed")}
        />
      )}
      {adminCreds.generatedPassword && !errors.login ? (
        <Button
          type="primary"
          block
          onClick={() => navigate("/chat", { replace: true })}
        >
          {t("wizard.finish.savedAndContinue")}
        </Button>
      ) : (
        <Button
          type="primary"
          block
          onClick={() => {
            wizardSession.clearAll();
            navigate("/login", { replace: true });
          }}
        >
          {t("wizard.finish.fallbackToLogin")}
        </Button>
      )}
    </Space>
  );
}
