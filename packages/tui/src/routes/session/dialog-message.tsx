import { createMemo } from "solid-js"
import { useSync } from "../../context/sync"
import { DialogSelect } from "../../ui/dialog-select"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useClipboard } from "../../context/clipboard"
import type { PromptInfo } from "../../component/prompt/history"
import { stripPromptPartIDs as strip } from "../../prompt/part"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
  /** 最后一个未完成的 assistant 消息 id; 消息 id 大于此值表示仍在排队 (QUEUED)。 */
  pending?: string
}) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute()
  const clipboard = useClipboard()

  /** 把指定消息的文本/文件部分还原回输入框 (供取消排队或回退后恢复用)。 */
  const restoreToPrompt = (msgID: string) => {
    if (!props.setPrompt) return
    const parts = sync.data.part[msgID]
    if (!parts) return
    const promptInfo = parts.reduce(
      (agg, part) => {
        if (part.type === "text") {
          if (!part.synthetic) agg.input += part.text
        }
        if (part.type === "file") agg.parts.push(strip(part))
        return agg
      },
      { input: "", parts: [] as PromptInfo["parts"] },
    )
    props.setPrompt(promptInfo)
  }

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            // 先关闭对话框（与原版同步行为一致），避免 await 期间用户重复触发。
            dialog.clear()

            // 排队中的消息 (QUEUED) 尚未被 LLM 处理, "回退"它没有意义 ——
            // 用户的意图是把它从队列撤销。用 deleteMessage 永久删除, 并把文本还原到输入框。
            const queued = props.pending && msg.id > props.pending
            if (queued) {
              await sdk.client.session.deleteMessage({
                sessionID: props.sessionID,
                messageID: msg.id,
              })
              restoreToPrompt(msg.id)
              return
            }

            // 等待 revert 请求完成后再恢复输入框文本，避免在 rollback 尚未结算时
            // 文本就出现在输入框，导致用户按下 Enter 后新消息错误地附加到被回退的范围上。
            const result = await sdk.client.session.revert({
              sessionID: props.sessionID,
              messageID: msg.id,
            })
            if (!result.data) return
            restoreToPrompt(msg.id)
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            const parts = sync.data.part[msg.id]
            const text = parts.reduce((agg, part) => {
              if (part.type === "text" && !part.synthetic) {
                agg += part.text
              }
              return agg
            }, "")

            await clipboard.write?.(text)
            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: async (dialog) => {
            const result = await sdk.client.session.fork({
              sessionID: props.sessionID,
              messageID: props.messageID,
            })
            const msg = message()
            const prompt = msg
              ? sync.data.part[msg.id].reduce(
                  (agg, part) => {
                    if (part.type === "text") {
                      if (!part.synthetic) agg.input += part.text
                    }
                    if (part.type === "file") agg.parts.push(part)
                    return agg
                  },
                  { input: "", parts: [] as PromptInfo["parts"] },
                )
              : undefined
            route.navigate({
              sessionID: result.data!.id,
              type: "session",
              prompt,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
