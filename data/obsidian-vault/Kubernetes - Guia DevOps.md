# Kubernetes - Guia DevOps

Data: 2026-06-10

# Kubernetes (K8s)

*O que é?*
Um sistema de orquestração de containers, essencial para deploy e gestão de aplicações em escala. Ele automatiza o deploy, o scaling e o gerenciamento de serviços.

*Conceitos Chave:*
- **Pod:** A menor unidade deployável (um ou mais container). 
- **Deployment:** Gerencia o estado desejado dos Pods, garantindo alta disponibilidade. 
- **Service:** Cria um IP estável e um DNS para acessar os Pods por trás.

*Por que usar?*
Garante escalabilidade horizontal, auto-recuperação de falhas e padronização do ambiente (Homelab/Produção).

## Próximos Passos:
- Revisar Ingress Controllers.
- Estudar StatefulSets para bases de dados.