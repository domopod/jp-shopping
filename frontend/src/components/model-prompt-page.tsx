'use client';

import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { Button, Card, Input, Space, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { fetchModelPrompts, updateModelPrompt } from '@/lib/api';
import type { ModelPromptConfig } from '@/lib/types';

const { TextArea } = Input;

interface PromptEditorState {
  key: string;
  value: string;
  isDirty: boolean;
}

export function ModelPromptPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<ModelPromptConfig[]>([]);
  const [editors, setEditors] = useState<Map<string, PromptEditorState>>(new Map());

  const loadPrompts = useCallback(async (showMessage = false) => {
    setLoading(true);
    try {
      const items = await fetchModelPrompts();
      setPrompts(items);
      const newEditors = new Map<string, PromptEditorState>();
      for (const item of items) {
        newEditors.set(item.key, {
          key: item.key,
          value: item.value,
          isDirty: false,
        });
      }
      setEditors(newEditors);
      if (showMessage) {
        messageApi.success('模型提示词已刷新');
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '获取模型提示词失败');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  function handleValueChange(key: ModelPromptConfig["key"], value: string) {
    const prompt = prompts.find((p) => p.key === key);
    const isDirty = prompt ? value !== prompt.value : false;
    setEditors((prev) => {
      const next = new Map(prev);
      next.set(key, { key, value, isDirty });
      return next;
    });
  }

  async function handleSave(key: ModelPromptConfig["key"]) {
    const editor = editors.get(key);
    if (!editor || !editor.isDirty) {
      return;
    }

    setSavingKey(key);
    try {
      const updated = await updateModelPrompt(key, editor.value);
      setPrompts((prev) =>
        prev.map((p) => (p.key === key ? updated : p)),
      );
      setEditors((prev) => {
        const next = new Map(prev);
        next.set(key, { key, value: updated.value, isDirty: false });
        return next;
      });
      messageApi.success('模型提示词已保存，新生成任务会使用最新提示词');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '保存模型提示词失败');
    } finally {
      setSavingKey(null);
    }
  }

  function handleResetToDefault(key: ModelPromptConfig["key"]) {
    const prompt = prompts.find((p) => p.key === key);
    if (!prompt) {
      return;
    }

    setEditors((prev) => {
      const next = new Map(prev);
      next.set(key, { key, value: prompt.defaultValue, isDirty: true });
      return next;
    });
  }

  return (
    <AdminShell
      title="模型提示词管理"
      extra={
        <Space>
          <Button className="admin-model-prompt-action-button" onClick={() => void loadPrompts(true)}>
            <ReloadOutlined />
            刷新
          </Button>
        </Space>
      }
    >
      {contextHolder}

      <Card bordered={false} className="admin-edit-card admin-edit-surface" loading={loading}>
        {prompts.length > 0 ? (
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
            {prompts.map((promptConfig) => {
              const editor = editors.get(promptConfig.key);
              const currentValue = editor?.value ?? promptConfig.value;
              const isDirty = editor?.isDirty ?? false;

              return (
                <div key={promptConfig.key} className="admin-image-manager-panel">
                  <div className="admin-image-manager-panel-header">
                    <div>
                      <Typography.Title level={5} style={{ margin: 0 }}>
                        {promptConfig.label}
                      </Typography.Title>
                      <Typography.Paragraph style={{ margin: '8px 0 0' }} type="secondary">
                        {promptConfig.description}
                      </Typography.Paragraph>
                    </div>
                    <Space>
                      {promptConfig.updatedAt ? (
                        <Typography.Text type="secondary">
                          最近更新：{new Date(promptConfig.updatedAt).toLocaleString('zh-CN')}
                        </Typography.Text>
                      ) : (
                        <Typography.Text type="secondary">当前使用默认提示词</Typography.Text>
                      )}
                      <Button
                        className="admin-form-cancel-button admin-model-prompt-action-button"
                        onClick={() => handleResetToDefault(promptConfig.key)}
                      >
                        恢复默认
                      </Button>
                      <Button
                        className="admin-form-save-button admin-model-prompt-save-button"
                        disabled={!isDirty}
                        loading={savingKey === promptConfig.key}
                        type="primary"
                        onClick={() => void handleSave(promptConfig.key)}
                      >
                        <SaveOutlined />
                        保存
                      </Button>
                    </Space>
                  </div>

                  <Space size={[8, 8]} wrap>
                    {promptConfig.placeholders.map((placeholder) => (
                      <Tag className="admin-model-prompt-tag" key={placeholder}>
                        {placeholder}
                      </Tag>
                    ))}
                  </Space>

                  <TextArea
                    className="admin-model-prompt-textarea"
                    rows={12}
                    value={currentValue}
                    onChange={(event) => handleValueChange(promptConfig.key, event.target.value)}
                  />
                </div>
              );
            })}
          </Space>
        ) : (
          <Typography.Text type="secondary">暂无可管理的模型提示词</Typography.Text>
        )}
      </Card>
    </AdminShell>
  );
}
