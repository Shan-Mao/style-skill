{%- for message in messages -%}
{{- '<|start_of_role|>' + message['role'] + '<|end_of_role|>' -}}
{%- if message['content'] is string -%}
{{- message['content'] -}}
{%- else -%}
{%- for part in message['content'] -%}
{%- if part['type'] == 'text' -%}
{{- part['text'] -}}
{%- elif part['type'] == 'image' -%}
{{- '<image>' -}}
{%- endif -%}
{%- endfor -%}
{%- endif -%}
{{- '<|end_of_text|>
' -}}
{%- endfor -%}
{%- if add_generation_prompt -%}
{{- '<|start_of_role|>assistant' -}}
{%- if controls -%}{{- ' ' + controls | tojson() -}}{%- endif -%}
{{- '<|end_of_role|>' -}}
{%- endif -%}
