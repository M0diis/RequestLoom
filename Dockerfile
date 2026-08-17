# ---- Stage 1: Build frontend ----
FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Build backend ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend-build
WORKDIR /src

COPY backend/RequestLoom.Api.csproj ./backend/
RUN dotnet restore backend/RequestLoom.Api.csproj

COPY backend/ ./backend/
COPY --from=frontend-build /src/frontend/dist ./backend/wwwroot

RUN dotnet publish backend/RequestLoom.Api.csproj -c Release -o /app

# ---- Stage 3: Runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libicu74 \
    && rm -rf /var/lib/apt/lists/*

ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=0
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
ENV Database__Path=/data/RequestLoom.db

RUN mkdir -p /data
VOLUME /data

EXPOSE 8080

COPY --from=backend-build /app ./

ENTRYPOINT ["dotnet", "RequestLoom.Api.dll"]
