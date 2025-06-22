from collections import defaultdict
from datetime import timezone, timedelta, datetime as dt
from typing import Optional
import streamlit as st
import pandas as pd
from datetime import datetime, timezone, timedelta
import urllib.parse
import requests
from google import genai
from google.genai import types
from google.api_core.client_options import ClientOptions
from google.cloud.discoveryengine_v1 import SearchServiceClient, SearchRequest

# --- set date ---
JST = timezone(timedelta(hours=9))
today = dt.now(JST)
one_week_later = today + timedelta(days=7)

from_dt_utc = today.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=9)
till_dt_utc = (today + timedelta(days=30)).replace(hour=23, minute=59, second=59, microsecond=999000) - timedelta(hours=9)

# 正しい形式に変換（ミリ秒.000 & Z表記）
from_date = from_dt_utc.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
till_date = till_dt_utc.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


# === グローバル辞書 ===
RISK_LEVEL_MAP = {
    "LOW": "低リスク",
    "MEDIUM": "中リスク",
    "HIGH": "高リスク",
    "INACTIVE": "無効"
}

ACTION_TYPE_MAP = {
    "INSECTICIDE_APPLICATION": "殺虫剤散布",
    "FUNGICIDE_APPLICATION": "殺菌剤散布",
    "HERBICIDE_APPLICATION": "除草剤散布",
}

STATUS_MAP = {
    "NECESSARY": "推奨",
    "OPTIONAL": "任意",
    "MISSED": "未実施",
    "NOT_NEEDED": "不要",
    "RECOMMENDED": "推奨",
}


# texts.py または main.py の冒頭に
TEXT = {
    "jp": {
        "header_title": "🚜 圃場優先順位ダッシュボード",
        "header_subtitle": "更新",
        "field_count": "📊 管理圃場数",
        "risk_alert": "⚠️ 病害リスク警戒",
        "download_csv": "📥 CSVダウンロード",
        "recommendation_title": "💡 本日の推奨アクション",
        "select_farm": "🚜 表示する農場を選んでください",
        "login_success": "✅ ログイン成功",
        "login_email": "メールアドレス",
        "login_password": "パスワード",
        "login_button": "ログイン",
        "data_fetch_button": "📥 圃場データを取得",
        "growth": "✅ 平均生育進捗",
        "action_field": "📌 本日確認すべき圃場 TOP10",
        "generate_recommend": "🔮 Gemini で推奨アクション生成",
        "attention": "🚨 要農薬対応圃場",
        
         
        
        
    },
    "en": {
        "header_title": "🚜 Field Priority Dashboard",
        "header_subtitle": "Updated",
        "field_count": "📊 Managed Fields",
        "risk_alert": "⚠️ Disease Risk Alert",
        "download_csv": "📥 Download CSV",
        "recommendation_title": "💡 Today's Recommended Actions",
        "select_farm": "🚜 Select Farm to Display",
        "login_success": "✅ Login Successful",
        "login_email": "Email",
        "login_password": "Password",
        "login_button": "Login",
        "data_fetch_button": "📥 Fetch Field Data",
        "growth": "✅ Average Growth",
        "attention": "🚨 Attention",
        "action_field": "📌 Check Fields TOP10",
        "generate_recommend": "🔮 Generate Action by Gemini",
    }
}

# --- to JST ---
def to_jst(date_str: Optional[str], is_end=False) -> Optional[datetime]:
    if not isinstance(date_str, str):
        return None
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00")).astimezone(JST)
        if is_end:
            return dt - timedelta(seconds=1)
        return dt
    except (ValueError, TypeError):
        return None

def stream_gemini_response(
    system_instruction, 
    user_text, 
    project_id, 
    location, 
    model_name, 
    temperature, 
    top_p, 
    max_output_tokens
):
    client = genai.Client(vertexai=True, project=project_id, location=location)

    contents = [
        types.Content(role="user", parts=[
            types.Part.from_text(system_instruction + "\n\n" + user_text)
        ])
    ]

    config = types.GenerateContentConfig(
        temperature=temperature,
        top_p=top_p,
        max_output_tokens=max_output_tokens,
        response_modalities=["TEXT"]
    )

    response_placeholder = st.empty()
    response_text = ""

    for chunk in client.models.generate_content_stream(
        model=model_name,
        contents=contents,
        config=config
    ):
        response_text += chunk.text
        # ✅ ここで先に置換する
        html_safe_text = response_text.replace('\n', '<br>')
        response_placeholder.markdown(
            f"""
            <div class="action-banner">
                <p>{html_safe_text}▌</p>
            </div>
            """,
            unsafe_allow_html=True
        )

    # ✅ 最後も同じ
    html_safe_text = response_text.replace('\n', '<br>')
    response_placeholder.markdown(
        f"""
        <div class="action-banner">
            <p>{html_safe_text}</p>
        </div>
        """,
        unsafe_allow_html=True
    )

    return response_text


    
def format_date_range(start, end):
    if start.date() == end.date():
        return f"{start.year}年{start.month}月{start.day}日"
    return f"{start.year}年{start.month}月{start.day}日～{end.year}年{end.month}月{end.day}日"


def filter_range(records, start_date, end_date, label=False):
    results = []
    for r in records or []:
        s, e = to_jst(r.get("startDate")), to_jst(r.get("endDate"), is_end=True)
        if s and e and s <= end_date and e >= start_date:
            desc = r.get("description", "") if label else ""
            results.append(format_range_with_label(s, e, desc))
    return results or ["推奨なし"]

def get_next_stage(preds, today):
    future = []
    for p in preds or []:
        s = to_jst(p.get("startDate"))
        if s and s > today:
            gs = p.get("cropGrowthStageV2") or {}
            name = gs.get("name", "不明")
            code = gs.get("code")
            label = f"{name}（BBCH {code}）" if code else name
            future.append((s, label))
    if not future:
        return "不明"
    s, l = sorted(future)[0]
    return f"{s.strftime('%Y年%-m月%-d日')}：{l}"

def append_risk_periods(source, key_fn, risk_periods, today, one_week_later):
    for r in source or []:
        uuid = key_fn(r)
        status = r.get("status")
        s, e = to_jst(r.get("startDate")), to_jst(r.get("endDate"), is_end=True)
        if uuid and s and e and s <= one_week_later and e >= today and status not in ["LOW", "INACTIVE"]:
            risk_periods[uuid][status].append((s, e))

def merge_action_ranges(records, start_date, end_date):
    """
    防除推奨専用: 同じ description ごとに期間をマージする
    """
    desc_periods = defaultdict(list)
    for r in records or []:
        s, e = to_jst(r.get("startDate")), to_jst(r.get("endDate"), is_end=True)
        if s and e and s <= end_date and e >= start_date:
            desc = r.get("description", "")
            desc_periods[desc].append((s, e))
    
    merged_results = []
    for desc, periods in desc_periods.items():
        merged = merge_periods(periods)
        for s, e in merged:
            merged_results.append(format_range_with_label(s, e, desc))
    return merged_results or ["推奨なし"]


def format_range_with_label(s, e, desc=""):
    if desc:
        return f"{format_date_range(s, e)}：{desc}"
    else:
        return format_date_range(s, e)


def merge_periods(periods):
    """すでに datetime のタプル化された [(s, e), ...] を結合するだけ"""
    if not periods:
        return []
    periods.sort()
    merged = []
    current_start, current_end = periods[0]
    for s, e in periods[1:]:
        if s <= current_end + timedelta(days=1):
            current_end = max(current_end, e)
        else:
            merged.append((current_start, current_end))
            current_start, current_end = s, e
    merged.append((current_start, current_end))
    return merged


# --- APIエンドポイントとキー（必要に応じて上部にまとめて定義） ---
BASE_LOGIN_URL = "https://accounts.eu1.gigya.com/accounts.login"
TOKEN_API_URL = "https://fm-api.xarvio.com/api/users/tokens"
GRAPHQL_END_POINT = "https://fm-api.xarvio.com/api/graphql/data"
API_KEY = "3_W-AXsoj7TvX-9gi7S-IGxXfLWVkEbnGSl57M7t49GN538umaKs2EID8hyipAux2y"

# --- 1. Gigyaログイン（LOGIN_TOKEN取得） ---
def login_to_gigya(email: str, password: str, api_key: str) -> dict:
    encoded_email = urllib.parse.quote(email)
    encoded_password = urllib.parse.quote(password)
    login_url = (
        f"{BASE_LOGIN_URL}?include=emails,profile,data,sessionInfo"
        f"&loginID={encoded_email}&password={encoded_password}&apiKey={api_key}"
    )
    response = requests.get(login_url)
    response.raise_for_status()
    return response.json()

# --- 2. DFトークン取得（Gigyaログイン情報を使って） ---
def get_df_token(login_data: dict) -> str:
    login_token = login_data["sessionInfo"]["cookieValue"]
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Cookie": f"LOGIN_TOKEN={login_token}"
    }
    payload = {
        "gigyaUuid": login_data["UID"],
        "gigyaUuidSignature": login_data["UIDSignature"],
        "gigyaSignatureTimestamp": login_data["signatureTimestamp"]
    }
    response = requests.post(TOKEN_API_URL, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()["token"]

# --- 3. 農場一覧取得（Farm UUIDと名前） ---
def get_farms(login_token: str, df_token: str) -> list:
    headers = {
        "Accept": "*/*",
        "Content-Type": "application/json",
        "Cookie": f"LOGIN_TOKEN={login_token}; DF_TOKEN={df_token}"
    }
    payload = {
        "operationName": "FarmsOverview",
        "variables": {},
        "query": """
            query FarmsOverview {
                farms: farmsV2(uuids: []) {
                    uuid
                    name
                    owner {
                        uuid
                        firstName
                        lastName
                        email
                    }
                }
            }
        """
    }
    response = requests.post(GRAPHQL_END_POINT, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()["data"]["farms"]

# --- 4. データ取得 ---
def get_plan_data(farm_uuid: str, login_token: str, df_token: str) -> list:

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        "Cookie": f"LOGIN_TOKEN={login_token}; DF_TOKEN={df_token}",
        "Origin": "https://fm.xarvio.com",
        "Referer": "https://fm.xarvio.com/"
    }

    payload= {
        "operationName": "CombinedFixedData",
        "variables": {
            "farmUuids": farm_uuid,
            "farmUuid": farm_uuid
        },
        "query": """
        query CombinedFixedData($farmUuids: [UUID!]!, $farmUuid: UUID!) {
            existingOrders(farmUuids: $farmUuids) {
                uuid
                status
                orderDate
                licenses { uuid quantity }
                shopFarmPackages { uuid packageUuid farmUuid validityInDays }
            }
            licenses {
                uuid
                name
                price
            }
            shopSubscriptions(farmUuids: $farmUuids) {
                uuid
                status
                renewalDate
                subscriptionItems {
                    sku quantity enabled
                    subscription { uuid renewalDate }
                }
            }
            fieldActivations(farmUuid: $farmUuid) {
                uuid
                fieldUuid
                package { uuid }
                status
                quantityPending
                quantityConsumed
            }
        }
        """
    }


    # --- Request ---
    response_plan = requests.post(GRAPHQL_END_POINT, json=payload, headers=headers)

    try:
        response_plan.raise_for_status()
        result = response_plan.json()

        if "data" not in result or not result["data"]:
            st.error("❌ GraphQLレスポンスに有効なデータが含まれていません。")
            return {}  # または適切なデフォルト値

 

        return result["data"]  # data 部分を返す
    except requests.exceptions.RequestException as e:
        st.error(f"❌ GraphQLリクエストエラー: {e}")
        return {}  # または適切なデフォルト値

# --- 4. データ取得 ---
def get_farm_data(farm_uuid: str, login_token: str, df_token: str) -> list:
    # JST基準の日付（例：今日から1ヶ月間）
    JST = timezone(timedelta(hours=9))
    now_jst = datetime.now(JST)

    from_dt_utc = now_jst.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=9)
    till_dt_utc = (now_jst + timedelta(days=30)).replace(hour=23, minute=59, second=59, microsecond=999000) - timedelta(hours=9)

    # 正しい形式に変換（ミリ秒.000 & Z表記）
    from_date = from_dt_utc.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
    till_date = till_dt_utc.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        "Cookie": f"LOGIN_TOKEN={login_token}; DF_TOKEN={df_token}",
        "Origin": "https://fm.xarvio.com",
        "Referer": "https://fm.xarvio.com/"
    }

    payload = {
        "operationName": "CombinedFieldData",
        "variables": {
            "farmUuids": farm_uuid,
            "fromDate": from_date,
            "tillDate": till_date,
            "languageCode": "ja",
            "countryCode": "jp",
            "cropSeasonLifeCycleStates": ["ACTIVE", "PLANNED"], #作期中、計画中、過去の作期["ACTIVE", "PLANNED", "CLOSED"]
            "withBoundary": False, #圃場の境界情報
            "withActionRecommendationAggregations": True, #作期の中の作業推奨（日付が近くならないとNULL?）
            "withCropSeasonsV2": True, #作付け情報
            "withnutritionRecommendations": True, #施肥推奨
            "withwaterRecommendations": True, #水管理推奨
            "withactionWindows": True, #作業推奨
            "withweedManagementRecommendations": True, #雑草管理プログラムからの推奨
            "withCropSeasonStatus": True, #病害リスク（作期の日付全部もすべて）
            "withNutritionStatus": True, #施肥推奨（5日分）
            "withWaterStatus": True, #水管理（5日分）
            "withrisk": True, #病害リスク（作期の日付全部もすべて）error
            "withHarvests": True, #収穫タスク
            "withCropEstablishments": True, #播種タスク
            "withLandPreparations": True, #土壌管理タスク
            "withDroneFlights": False, #ドローン空撮タスク（日本未対応）
            "withSeedTreatments": True, #種子処理タスク
            "withSeedBoxTreatments": True, #育苗期処理タスク
            "withSmartSprayingTasks": False, #スマートスプレータスク（日本未対応）
            "withWaterManagementTasks": True, #水管理タスク
            "withScoutingTasks": True, #スカウティングタスク
            "withObservations": True, #観察タスク
            "withSprayingsV2": True, #散布タスク（防除、施肥タスク）
            "withSoilSamplingTasks": False, #多分日本未対応
            "withImportantGrowthStage": False,
            "withcountryCropGrowthStagePredictions": True, #生育ステージ予測
            "withWeedRiskDetails": True #雑草リスク
        },
        "query": """
        query CombinedFieldData(
            $farmUuids: [UUID!]!,
            $fromDate: Date!,
            $tillDate: Date!,
            $languageCode: String!,
            $countryCode: String!,
            $cropSeasonLifeCycleStates: [LifecycleState]!,
            $withActionRecommendationAggregations: Boolean!,
            $withCropSeasonsV2: Boolean!,
            $withCropSeasonStatus: Boolean!,
            $withnutritionRecommendations: Boolean!,
            $withwaterRecommendations: Boolean!,
            $withactionWindows: Boolean!,
            $withweedManagementRecommendations: Boolean!,
            $withrisk: Boolean!,
            $withNutritionStatus: Boolean!,
            $withWaterStatus: Boolean!,
            $withHarvests: Boolean!,
            $withCropEstablishments: Boolean!,
            $withLandPreparations: Boolean!,
            $withDroneFlights: Boolean!,
            $withSeedTreatments: Boolean!,
            $withSeedBoxTreatments: Boolean!,
            $withSmartSprayingTasks: Boolean!,
            $withWaterManagementTasks: Boolean!,
            $withScoutingTasks: Boolean!,
            $withObservations: Boolean!,
            $withSprayingsV2: Boolean!,
            $withSoilSamplingTasks: Boolean!,
            $withImportantGrowthStage: Boolean!,
            $withcountryCropGrowthStagePredictions: Boolean!,
            $withBoundary: Boolean!
        ) {
    
            fieldsV2(farmUuids: $farmUuids) {
                uuid
                name
                area
                boundary @include(if: $withBoundary)
            cropSeasonsV2(lifecycleState: $cropSeasonLifeCycleStates) @include(if: $withCropSeasonsV2){
                    uuid
                    startDate
                    
                    actionRecommendations{
                    startDate
                    endDate
                    status
                    actionType: type
                    confidenceLevel}
                    
                    activeGrowthStage{
                      index
                      gsOrder
                      scale
                      }
                    lifecycleState
                    crop(languageCode: $languageCode) {
                        name
                    }
                    variety(languageCode: $languageCode) {
                        name
                    }
                    actionRecommendationAggregations(actionStatus: ACTIVE) @include(if: $withActionRecommendationAggregations) {
                        aggregatedStatus
                    }
                    nutritionRecommendations(fromDate: $fromDate, tillDate: $tillDate) @include(if: $withnutritionRecommendations){
                      startDate
                      endDate
                      status
                      actionType
                    }
                    waterRecommendations @include(if: $withwaterRecommendations){
                      startDate
                      endDate
                      description
                      actionType
    
                    }
                    actionWindows(fromDate: $fromDate, tillDate: $tillDate) @include(if: $withactionWindows){
                      startDate
                      endDate
                      actionType
                      status
                      cropSeasonUuid
                    }
    
                    weedManagementRecommendations @include(if: $withweedManagementRecommendations){
                      startDate
                      endDate
                      status
                      type
                      confidenceLevel
                    }
    
    
          cropSeasonStatus(fromDate: $fromDate, tillDate: $tillDate) @include(if: $withCropSeasonStatus){
            startDate
            endDate
            status
            type
          }
    
          nutritionStatus @include(if: $withNutritionStatus){
            startDate
            endDate
            status
            __typename
          }
    
          waterStatus(fromDate: $fromDate, tillDate: $tillDate) @include(if: $withWaterStatus){
            startDate
            endDate
            status
            __typename
          }
          risks(fromDate: $fromDate, tillDate: $tillDate) @include(if: $withrisk)
          {
            startDate
            endDate
            status
            __typename
            stressV2{
              uuid
              __typename
            }
            }
            timingStressesInfo{
              stressV2(languageCode: $languageCode){
                uuid
                stressTypeCode
                name
                __typename
              }
            }
    
    
                    harvests @include(if: $withHarvests) {
                        uuid
                        plannedDate
                        assignmentState
                        state
                        executionDate
                        yieldProperties
                        yield
                        harvestMethodCode
                    }
                    observations @include(if: $withObservations) {
                        uuid
                        executionDate
                        stressAnswers(language: $languageCode) {
                            uuid
                            label
                            stressQuestion(language: $languageCode) {
                                stressV2(languageCode: $languageCode) {
                                    name
                                    code
                                }
                            }
                        }
                        importantStage @include(if: $withImportantGrowthStage) {
                            cropGrowthStageV2(languageCode: $languageCode, countryCode: $countryCode) {
                                name
                                code
                            }
                        }
                    }
                    smartSprayingTasksV2 @include(if: $withSmartSprayingTasks) {
                        uuid
                        plannedDate
                        executionDate
                        state
                        dosedMaps {
                            tankNumber
                            dosedMap {
                                uuid
                                applicationType
                            }
                        }
                    }
                    sprayingsV2 @include(if: $withSprayingsV2) {
                      uuid
                      autoExecutedOn
                      plannedDate
                      executionDate
                      isAutoExecutable
                      note
                      assignmentState
                      state
                      dosedMap{
                          applicationType
                          recipeV2{
                              name
                          }
                      }
    
                      }
                    seedTreatmentTasks @include(if: $withSeedTreatments) {
                        uuid
                        autoExecutedOn
                        plannedDate
                        executionDate
                        isAutoExecutable
                        note
                        assignmentState
                        totalLiquidRate
                        state
                        recipe{
                            name
                            }
                    }
                    seedBoxTreatments @include(if: $withSeedBoxTreatments) {
                        uuid
                        plannedDate
                        executionDate
                        autoExecutedOn
                        isAutoExecutable
                        note
                        assignmentState
                        state
                        recipe{
                            name
                        }
                    }
                    cropEstablishments @include(if: $withCropEstablishments) {
                        uuid
                        assignmentState
                        note
                        dosedMap{
                            applicationMode
                            applicationType
                            sourceMap{
                              sourceDate
                            }
                        }
                    }
                    landPreparations @include(if: $withLandPreparations) {
                        uuid
                        plannedDate
                        executionDate
                        autoExecutedOn
                        isAutoExecutable
                        note
                        assignmentState
                        state
                        tillageDepth
                        processedArea
    
                    }
                    waterManagementTasks @include(if: $withWaterManagementTasks) {
                          uuid
                          plannedDate
                          executionDate
                          autoExecutedOn
                          isAutoExecutable
                          note
                          state
                          type
                          waterHeightDifference
                          waterHeight
                          executionStartDate
                          fieldCoveragePercentage
                                        }
                    scoutingTasks @include(if: $withScoutingTasks) {
                        uuid
                        plannedDate
                        executionDate
                        state
                    }
                    droneFlights @include(if: $withDroneFlights) {
                        uuid
                        status
                        executedDate
                        plannedDate
                        warningCode
                    }
                    soilSamplingTasks @include(if: $withSoilSamplingTasks) {
                        uuid
                        plannedDate
                        executionDate
                        state
                    }
                    cropEstablishmentGrowthStageIndex
                    cropEstablishmentMethodCode
                    countryCropGrowthStagePredictions(fromDate: $fromDate, tillDate: $tillDate) @include(if: $withcountryCropGrowthStagePredictions) {
                        index
                        startDate
                        endDate
                        scale
                        gsOrder
                        cropGrowthStageV2(languageCode: $languageCode) {
                            uuid
                            name
                            code
                        }
                    }
                }
            }
        }
        """
    }
    
    response_active_planned_cs = requests.post(GRAPHQL_END_POINT, json=payload, headers=headers)
    response_active_planned_cs.raise_for_status()
    response = requests.post(GRAPHQL_END_POINT, json=payload, headers=headers)
    try:
        response.raise_for_status()
        result = response.json()

        if "data" not in result or not result["data"]:
            st.error("❌ GraphQLレスポンスに有効なデータが含まれていません。")
            return {}  # または適切なデフォルト値



        return result["data"]  # data 部分を返す
    except requests.exceptions.RequestException as e:
        st.error(f"❌ GraphQLリクエストエラー: {e}")
        return {}  # または適切なデフォルト値



# === ✅ Marge plan_data and response_active_planned_cs ===


# --- ページ設定 ---
st.set_page_config(page_title="圃場優先順位ダッシュボード", layout="wide")

with st.sidebar:
    lang = st.radio("🌐 言語 / Language", ["jp", "en"], index=0)
    
# Load CSS
with open("styles.css") as f:
    st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)

# --- セッションステート初期化 ---
for key in ["is_logged_in", "login_token", "df_token", "farms", "selected_farm_uuid", "field_data", "full_data", "farm_dataframe"]:
    if key not in st.session_state:
        st.session_state[key] = None if "token" in key or "farm_dataframe" in key else False if key == "is_logged_in" else {}


# --- ログインフォーム ---
if not st.session_state.is_logged_in:
    with st.form("login_form"):
        email = st.text_input(TEXT[lang]["login_email"])
        password = st.text_input(TEXT[lang]["login_password"], type="password")
        submitted = st.form_submit_button(TEXT[lang]["login_button"])


    if submitted:
        with st.spinner("ログイン処理中..."):
            try:
                login_data = login_to_gigya(email, password, API_KEY)
                df_token = get_df_token(login_data)

                st.session_state.login_token = login_data["sessionInfo"]["cookieValue"]
                st.session_state.df_token = df_token
                st.session_state.is_logged_in = True

                # farms 一覧を取得・保存
                farms = get_farms(st.session_state.login_token, df_token)
                st.session_state.farms = farms

                st.rerun()  # ログイン後の状態へ遷移

            except Exception as e:
                st.error(f"❌ ログイン失敗: {str(e)}")

# --- ログイン済み処理 ---
if st.session_state.is_logged_in:
    st.success("✅ ログイン成功")

    # --- 農場選択 ---
    farms = st.session_state.farms
    farm_dict = {f["name"]: f["uuid"] for f in farms}
    farm_name = st.selectbox(TEXT[lang]["select_farm"], list(farm_dict.keys()))
    farm_uuid = farm_dict[farm_name]
    st.session_state.selected_farm_uuid = farm_uuid

    # --- データ取得ボタン ---
    if st.button("📥 圃場データを取得"):
        with st.spinner("データ取得中..."):
            try:
                plan_data = get_plan_data(farm_uuid, st.session_state.login_token, st.session_state.df_token)
                farm_data = get_farm_data(farm_uuid, st.session_state.login_token, st.session_state.df_token)

                # === ✅ セッションに保存 ===
                st.session_state.plan_data = plan_data
                st.session_state.farm_data = farm_data

                st.success("✅ データ取得成功")
                st.rerun()

            except Exception as e:
                st.error(f"❌ データ取得失敗: {e}")


plan_data = st.session_state.get("plan_data")
farm_data = st.session_state.get("farm_data")

df = pd.DataFrame()

records = []
if plan_data and farm_data:
    fields = farm_data["fieldsV2"]

    orders = plan_data["existingOrders"]
    licenses = plan_data["licenses"]
    activations = plan_data["fieldActivations"]

    package_name_map = {}
    for order in orders:
        if order.get("status") != "complete":
            continue
        for lic, pkg in zip(order.get("licenses", []), order.get("shopFarmPackages", [])):
            package_name_map[pkg["packageUuid"]] = next(
                (l["name"] for l in licenses if l["uuid"] == lic["uuid"]),
                "不明ライセンス"
            )

    field_uuid_map = {f["uuid"]: f.get("name", "不明") for f in fields}

    activation_map = defaultdict(set)
    for act in activations:
        field_name = field_uuid_map.get(act["fieldUuid"], "不明")
        pkg_uuid = act.get("package", {}).get("uuid")
        name = package_name_map.get(pkg_uuid, "不明")
        if "追加機能" in name:
            activation_map[field_name].add(f"{name}（{round(act.get('quantityConsumed', 0), 2)}a）")



    for field in fields:
        field_name = field.get("name", "不明")
        field_area = round(field.get("area", 0), 2)

        for season in field.get("cropSeasonsV2") or []:
            if season.get("lifecycleState") == "CLOSED":
                continue

            crop = season.get("crop", {}).get("name", "不明")
            variety = season.get("variety", {}).get("name", "不明")
            stage = season.get("activeGrowthStage") or {}
            stage_text = f"BBCH {stage.get('index')}" if stage.get('index') else ""


            water = "\n".join(filter_range(season.get("waterRecommendations"), today, one_week_later, label=True))
            fert = " / ".join(filter_range(season.get("nutritionRecommendations"), today, one_week_later))

            action = " / ".join(
                merge_action_ranges(
                    [
                        {
                            **r,
                            "description": f"{ACTION_TYPE_MAP.get(r.get('actionType'), r.get('actionType'))}（{STATUS_MAP.get(r.get('status'), r.get('status'))}）"
                        }
                        for r in (season.get("actionRecommendations") or [])
                        if r.get("status") and r.get("status") != "NOT_NEEDED"
                    ],
                    today, one_week_later
                )
            )


            weed = " / ".join(
                filter_range(
                    [
                        {
                            **r,
                            "description": f"{ACTION_TYPE_MAP.get(r.get('type') or '不明作業', r.get('type') or '不明作業')}（{STATUS_MAP.get(r.get('status') or '不明', r.get('status') or '不明')}）"
                        }
                        for r in (season.get("weedManagementRecommendations") or [])
                        if r.get("status") and r.get("status") != "NOT_NEEDED"
                    ],
                    today, one_week_later, label=True
                )
            )


            # --- risk ---
            uuid_name = {
                s.get("stressV2", {}).get("uuid"): s.get("stressV2", {}).get("name", "不明")
                for s in season.get("timingStressesInfo") or [] if s.get("stressV2")
            }
            uuid_name["WATER_STATUS"] = "水管理ステータス"

            risk_periods = defaultdict(lambda: defaultdict(list))

            append_risk_periods(
                season.get("risks"), 
                lambda r: r.get("stressV2", {}).get("uuid"), 
                risk_periods, today, one_week_later
            )

            append_risk_periods(
                season.get("waterStatus"), 
                lambda w: "WATER_STATUS",
                risk_periods, today, one_week_later
            )


            risks = []
            for uuid, statuses in risk_periods.items():
                name = uuid_name.get(uuid, "不明")
                for stat, periods in statuses.items():
                    if not periods:
                        continue
                    merged_ranges = merge_periods(periods)

                    risk_status_jp = RISK_LEVEL_MAP.get(stat, stat)
                    for s, e in merged_ranges:
                        risks.append(f"{name}（{risk_status_jp}）：{format_date_range(s, e)}")


            risk_text = "\n".join(risks) or "推奨なし"



            preds = season.get("countryCropGrowthStagePredictions") or []
            next_stage_text = get_next_stage(preds, today)


            records.append({
                "圃場名": field_name,
                "面積[a]": field_area,
                "作物": crop,
                "品種": variety,
                "生育ステージ": stage_text,
                "次のステージ予測": next_stage_text,
                "防除推奨": action,
                "水管理推奨": water,
                "雑草管理プログラム": weed,
                "病害虫リスク": risk_text,
                "施肥推奨": fert,
                "割当ライセンス": "\n".join(sorted(activation_map.get(field_name, ["追加機能なし"])))


            })
else:
    st.info("📥 データ取得ボタンを押して、最新の圃場データを取得してください。")
    
df = pd.DataFrame(records)
st.session_state.farm_dataframe = df

# farm_name を安全にセット
farm_name = st.session_state.get("farm_name", "（未選択）")

if st.session_state.get("farms") and st.session_state.get("selected_farm_uuid"):
    # farms があるときだけ正しい farm_name をセット
    farms = st.session_state["farms"]
    farm_dict = {f["uuid"]: f["name"] for f in farms}
    farm_name = farm_dict.get(st.session_state["selected_farm_uuid"], farm_name)


# --- ヘッダー ---
st.markdown(
    f"""
    <div class="header-container">
        <h2 class="header-title" style="color: white;">{TEXT[lang]['header_title']}</h2>
        <p class="header-subtitle">{farm_name}・{today.strftime("%Y-%m-%d %H:%M")} {TEXT[lang]['header_subtitle']}</p>
    </div>
    """,
    unsafe_allow_html=True,
)

# ✅ ドロップダウン追加
if not df.empty:
    #crop_list = sorted(df["作物"].dropna().unique().tolist())
    #selected_crop = st.selectbox("作物を選択", ["すべて"] + crop_list, index=0)
    # 変更後：優先作物を先頭に、それ以外を辞書順に追加
    priority_crops = ["稲", "麦", "大豆", "甜菜"]

    # データに含まれる全作物
    all_crops = df["作物"].dropna().unique().tolist()

    # 優先作物（データに含まれているものだけ）
    ordered_crops = [crop for crop in priority_crops if crop in all_crops]

    # 優先作物以外を辞書順に
    other_crops = sorted([crop for crop in all_crops if crop not in priority_crops])

    # 結合
    ordered_crops += other_crops

    # ドロップダウンに反映
    selected_crop = st.selectbox(
        "作物を選択",
        ["すべて"] + ordered_crops,
        index=0
    )


    # 品種は作物で絞ってから取得
    if selected_crop != "すべて":
        variety_list = sorted(df[df["作物"] == selected_crop]["品種"].dropna().unique().tolist())
    else:
        variety_list = sorted(df["品種"].dropna().unique().tolist())

    selected_variety = st.selectbox("品種を選択", ["すべて"] + variety_list, index=0)

    # --- フィルタリング ---
    filtered_df = df.copy()
    if selected_crop != "すべて":
        filtered_df = filtered_df[filtered_df["作物"] == selected_crop]
    if selected_variety != "すべて":
        filtered_df = filtered_df[filtered_df["品種"] == selected_variety]

    # セッションに保存
    st.session_state["filtered_df"] = filtered_df

else:
    st.session_state["filtered_df"] = df.copy()


with st.sidebar:
    st.header("🔧 Google Cloud Setting")
    project_id = st.text_input("Project ID", "prj-basf-xarviobot-dev")
    location = st.text_input("Gemini Location", "us-central1")

    st.header("🤖 Gemini model")
    model_name = st.selectbox("モデル選択", ["gemini-1.5-flash-002", "gemini-1.5-pro-002"], index=0)
    temperature = st.slider("Temperature", 0.0, 2.0, 0.5)
    top_p = st.slider("Top-p", 0.0, 1.0, 0.95)
    max_tokens = st.number_input("Max output tokens", 128, 8192, 2048)


# ✅ フィルタ結果をdfとして扱う
df = st.session_state["filtered_df"]

num_fields = df["圃場名"].nunique() if not df.empty else 0
total_area = df["面積[a]"].sum() if not df.empty else 0
num_risks = df[df["病害虫リスク"] != "推奨なし"].shape[0] if not df.empty else 0


# KPI HTMLを更新
kpi_html = f"""
<div class="kpi-container">
  <div class="kpi-card kpi-card-red">
    <h4>{TEXT[lang]['attention']}</h4>
    <div class="kpi-value">12</div>
    <div class="kpi-change-red">▲ 前日比 +3</div>
  </div>

  <div class="kpi-card kpi-card-orange">
    <h4>{TEXT[lang]['risk_alert']}</h4>
    <div class="kpi-value">{num_risks}</div>
    <div class="kpi-change-red">▲ 前回比 +5</div>
  </div>

  <div class="kpi-card kpi-card-blue">
    <h4>{TEXT[lang]['field_count']}</h4>
    <div class="kpi-value">{num_fields}</div>
    <div class="kpi-change-gray">{total_area:.0f}a</div>
  </div>

  <div class="kpi-card kpi-card-green">
    <h4>{TEXT[lang]['growth']}</h4>
    <div class="kpi-value">89%</div>
    <div class="kpi-change-green">▼ 平年比 -2%</div>
  </div>
</div>
"""


# 再描画
st.markdown(kpi_html, unsafe_allow_html=True)


st.markdown("---")

# --- 圃場一覧（テーブル）---
st.subheader(TEXT[lang]['action_field'])


def get_risks_percent(risks):
    if "HIGH" in risks:
        return 80
    elif "MEDIUM" in risks:
        return 50
    elif "LOW" in risks:
        return 20
    return 10

st.download_button(
    label=TEXT[lang]['download_csv'],
    data=df.to_csv(index=False),
    file_name="field_status_details.csv",
    mime="text/csv",
)





# Create HTML table with progress bar
html_table = """
<div class="table-container">
<table class="custom-table">
    <thead>
        <tr>
"""

# Add table headers
for col in df.columns:
    html_table += f"<th>{col}</th>"
html_table += "</tr></thead><tbody>"

# Add table rows
for _, row in df.iterrows():
    html_table += "<tr>"
    for col in df.columns:
        if col == "病害リスク":
            # Create progress bar for risk percentage
            risk_value = row[col]
            color = "#cc0000"
            html_table += f"""
            <td>
                <div class="risk-cell">
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: {risk_value}%; background-color: {color};">
                        </div>
                    </div>
                    <span class="risk-value">{risk_value}%</span>
                </div>
            </td>"""
        elif col == "優先度":
            color = "#000000"
            bg_color = "#ffffff"
            if row[col] == "緊急":
                color = "#cc0000"  # 濃い赤
                bg_color = "#ffc6c6"  # 薄い赤
            elif row[col] == "高":
                color = "#e3b600"  # 濃い黄色
                bg_color = "#fff8c6"  # 薄い黄色
            elif row[col] == "中":
                color = "#0000cc"  # 濃い青
                bg_color = "#e6e6ff"  # 薄い青
            elif row[col] == "低":
                color = "#006600"  # 濃い緑
                bg_color = "#d6ffd6"  # 薄い緑
            html_table += f"<td><span class='priority-badge' style='color: {color}; background-color: {bg_color};'>{row[col]}</span></td>"
        else:
            cell_value = row[col] if pd.notna(row[col]) else ''
            # ✅ 改行を <br> に置換
            cell_value = str(cell_value).replace("\n", "<br>")
            html_table += f"<td>{cell_value}</td>"

    html_table += "</tr>"

html_table += """
    </tbody>
</table>
</div>
"""

st.markdown(html_table, unsafe_allow_html=True)

# --- 推奨アクションバナー ---
st.subheader(TEXT[lang]['recommendation_title'])

if st.session_state.get("farm_dataframe") is not None and not st.session_state.farm_dataframe.empty:

    if st.button(TEXT[lang]['generate_recommend']):
        df = st.session_state.farm_dataframe
        today_str = today.strftime("%Y-%m-%d")

        table_text = df.head(20).to_markdown(index=False)  # 上位20だけ

        # ✅ 1) 言語ごとに system_instruction を切り替える
        if lang == "jp":
            system_instruction = f"""
            あなたは農業管理の専門家です。
            圃場状況に基づき、優先すべき作業を 3-5 件、具体的に提案してください。
            割当ライセンスが追加機能なし、または予測機能が含まれていない場合は生育ステージ、次のステージ予測、防除推奨、水管理推奨、雑草管理プログラム、病害虫リスク、施肥推奨は推奨なし、不明、空欄になります。
            作物が稲、麦、大豆、甜菜の場合は回答の最後に生育予測機能の購入と機能の割り当てを行うように推奨してください。
            作物が稲または甜菜で、割当ライセンスに生育予測機能が含まれている場合のみ水管理推奨は表示されます。
            その他の作物の場合は、予測機能がないので、推奨アクションはありません。

            今日は {today_str} です。出力には日付を繰り返さないでください。
            """
        else:
            system_instruction = f"""
            You are an agricultural management expert.
            Based on the field status, propose 3-5 specific actions to prioritize today.
            If the assigned license has no additional features or prediction functionality, treat growth stage, next stage prediction, pest control, water management, weed management program, pest/disease risk, and fertilization recommendation as unavailable or blank.
            For rice, wheat, soybeans, or sugar beets, add a note at the end recommending purchasing and assigning the growth prediction feature.
            Water management recommendations appear only for rice and sugar beets if the license includes the prediction feature.
            For other crops, there are no recommendations due to lack of prediction capability.

            Today is {today_str}. Do not repeat the date in the output.
            """

        # ✅ 2) 共通の user_text
        user_text = f"## 圃場データ\n\n{table_text}"

        # ✅ 3) 共通の呼び出し
        response_text = stream_gemini_response(
            system_instruction,
            user_text,
            project_id,
            location,
            model_name,
            temperature,
            top_p,
            max_tokens
        )

        st.session_state["gemini_recommendation"] = response_text

